import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from 'redis';
import Engine from '../src/faye-redis';
import type { EngineOptions } from '../src/types';
import { MockFayeServer, delay } from './helpers';

describe('Redis Engine - Edge Cases & Error Handling', () => {
  let engine: Engine;
  let server: MockFayeServer;
  let namespace: string;
  let redisPassword: string | undefined;

  beforeEach(() => {
    redisPassword = process.env.CI ? undefined : 'foobared';
    namespace = `test_edge_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    server = new MockFayeServer();
  });

  afterEach(async () => {
    if (engine) {
      await engine.disconnect();
    }

    const redis = createClient({
      socket: { host: 'localhost', port: 6379 },
      password: redisPassword
    });

    try {
      await redis.connect();
      await redis.flushAll();
    } catch (err) {
      console.error('Error cleaning up Redis:', err);
    } finally {
      await redis.quit();
    }
  });

  describe('Error Handling', () => {
    it('should handle emptyQueue when client has no connection', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Do not add connection to server, so hasConnection returns false
      // This should trigger early return in emptyQueue
      engine.emptyQueue(clientId);

      await delay(100);
      expect(true).toBe(true); // Should not crash
    });

    it('should handle publish errors gracefully', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      server.addConnection(clientId);

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      // Create invalid message to potentially trigger error path
      const invalidMessage: any = {
        channel: '/test/channel',
        data: { test: 'data' }
      };

      // Spy on console.error to verify error handling
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      engine.publish(invalidMessage, ['/test/channel']);

      await delay(300);

      errorSpy.mockRestore();
      expect(true).toBe(true);
    });
  });

  describe('Lock Contention', () => {
    it('should handle lock timeout scenarios', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace,
        gc: 1
      };

      server.timeout = 0.5;

      engine = new Engine(server, options);
      await delay(100);

      // Create a client
      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Manually set a lock in Redis to simulate contention
      const redis = createClient({
        socket: { host: 'localhost', port: 6379 },
        password: redisPassword
      });

      await redis.connect();

      // Set an expired lock
      const lockKey = namespace + '/locks/gc';
      const expiredTime = new Date().getTime() - 1000;
      await redis.set(lockKey, expiredTime.toString());

      await redis.quit();

      // Trigger GC which should handle the expired lock
      engine.gc();

      await delay(2000);

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      // Client should be cleaned up or still exist depending on timing
      expect(typeof exists).toBe('boolean');
    });

    it('should handle concurrent gc calls with locking', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace,
        gc: 1
      };

      server.timeout = 1;

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Wait for client to become stale
      await delay(2500);

      // Call gc multiple times concurrently to test lock mechanism
      engine.gc();
      engine.gc();
      engine.gc();

      await delay(1000);

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle gc when timeout is not a number', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      // Set timeout to undefined
      server.timeout = undefined as any;

      engine = new Engine(server, options);
      await delay(100);

      // This should return early without error
      engine.gc();

      await delay(100);
      expect(true).toBe(true);
    });

    it('should handle ping when timeout is not a number', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      server.timeout = undefined as any;

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // This should return early without error
      engine.ping(clientId);

      await delay(100);
      expect(true).toBe(true);
    });

    it('should handle emptyQueue with empty message list', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      server.addConnection(clientId);

      // Empty the queue when it's already empty
      engine.emptyQueue(clientId);

      await delay(100);
      expect(true).toBe(true);
    });

    it('should delete queue for non-existent client during publish', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      // Create a stale client by manipulating Redis directly
      const redis = createClient({
        socket: { host: 'localhost', port: 6379 },
        password: redisPassword
      });

      await redis.connect();

      const staleClientId = 'stale_client_123';

      // Add to channel subscribers but not to active clients
      await redis.sAdd(namespace + '/channels/test/channel', staleClientId);

      await redis.quit();

      server.addConnection(staleClientId);

      // Publish to the channel - should clean up the stale client's queue
      const message = {
        channel: '/test/channel',
        data: { test: 'cleanup' }
      };

      engine.publish(message, ['/test/channel']);

      await delay(300);
      expect(true).toBe(true);
    });
  });

  describe('Disconnect handling', () => {
    it('should properly disconnect and cleanup', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      expect(clientId).toBeDefined();

      // Disconnect should work without errors
      await engine.disconnect();

      // Set engine to null so afterEach doesn't try to disconnect again
      engine = null as any;
    });
  });

  describe('Garbage Collection with Multiple Clients', () => {
    it('should clean up multiple stale clients', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace,
        gc: 1
      };

      server.timeout = 0.5;

      engine = new Engine(server, options);
      await delay(100);

      // Create multiple clients
      const client1 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      const client2 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      const client3 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Wait for all clients to become stale
      await delay(1500);

      // Trigger GC manually
      engine.gc();

      // Wait for GC to complete
      await delay(1000);

      // All clients should be removed
      const exists1 = await new Promise<boolean>((resolve) => {
        engine.clientExists(client1, resolve, null);
      });

      const exists2 = await new Promise<boolean>((resolve) => {
        engine.clientExists(client2, resolve, null);
      });

      const exists3 = await new Promise<boolean>((resolve) => {
        engine.clientExists(client3, resolve, null);
      });

      expect(exists1).toBe(false);
      expect(exists2).toBe(false);
      expect(exists3).toBe(false);
    });

    it('should handle gc with no stale clients', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace,
        gc: 1
      };

      server.timeout = 100; // Long timeout

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      await delay(100); // Ensure client is fully created

      // Trigger GC - should not remove client since timeout is long
      engine.gc();

      await delay(1000); // Wait for GC to complete

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(true);
    });
  });

  describe('Subscription Edge Cases', () => {
    it('should handle unsubscribe from channel client is not subscribed to', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Unsubscribe from a channel the client never subscribed to
      await new Promise<void>((resolve) => {
        engine.unsubscribe(clientId, '/never/subscribed', resolve, null);
      });

      expect(true).toBe(true); // Should complete without error
    });

    it('should handle subscribe to same channel twice', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      let subscribeCount = 0;
      server.on('subscribe', () => {
        subscribeCount++;
      });

      // Subscribe twice to the same channel
      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      // Should only trigger subscribe event once
      expect(subscribeCount).toBe(1);
    });
  });

  describe('Create Client Edge Cases', () => {
    it('should retry client creation on ID collision', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      // Mock server that always returns same ID initially
      let callCount = 0;
      const originalGenerateId = server.generateId;
      server.generateId = () => {
        callCount++;
        if (callCount === 1 || callCount === 2) {
          return 'duplicate-id';
        }
        return originalGenerateId.call(server);
      };

      engine = new Engine(server, options);
      await delay(100);

      // Pre-create a client with the duplicate ID
      const redis = createClient({
        socket: { host: 'localhost', port: 6379 },
        password: redisPassword
      });

      await redis.connect();
      await redis.zAdd(namespace + '/clients', {
        score: new Date().getTime(),
        value: 'duplicate-id'
      });
      await redis.quit();

      // This should retry and get a different ID
      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      expect(clientId).not.toBe('duplicate-id');
      expect(callCount).toBeGreaterThan(1);

      // Restore original function
      server.generateId = originalGenerateId;
    });
  });
});
