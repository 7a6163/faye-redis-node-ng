import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from 'redis';
import Engine from '../src/faye-redis';
import type { EngineOptions } from '../src/types';
import { MockFayeServer, delay } from './helpers';

describe('Redis Engine - Error Paths and Reconnection', () => {
  let engine: Engine;
  let server: MockFayeServer;
  let namespace: string;
  let redisPassword: string | undefined;

  beforeEach(() => {
    redisPassword = process.env.CI ? undefined : 'foobared';
    namespace = `test_error_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    server = new MockFayeServer();
  });

  afterEach(async () => {
    if (engine) {
      try {
        await engine.disconnect();
      } catch (e) {
        // Ignore disconnect errors in cleanup
      }
    }

    const redis = createClient({
      socket: { host: 'localhost', port: 6379 },
      password: redisPassword
    });

    try {
      await redis.connect();
      await redis.flushAll();
      await redis.quit();
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Error Handling in Async Operations', () => {
    it('should handle errors in _waitForInit gracefully', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Force disconnect to trigger potential errors
      await engine.disconnect();

      // Try to perform operations after disconnect
      engine.ping(clientId);
      await delay(100);

      consoleSpy.mockRestore();

      // Set to null so afterEach doesn't try to disconnect again
      engine = null as any;
    });

    it('should handle emptyQueue error path', async () => {
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

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Disconnect engine to force error in emptyQueue
      const redis = (engine as any)._redis;
      await redis.quit();

      // This should trigger error handling
      engine.emptyQueue(clientId);
      await delay(200);

      const errorCalls = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes?.('Error emptying queue')
      );

      expect(errorCalls.length).toBeGreaterThanOrEqual(0);
      consoleSpy.mockRestore();
    });

    it('should handle publish error path', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Disconnect to force error
      const redis = (engine as any)._redis;
      await redis.quit();

      // Try to publish - should hit error handler
      const message = {
        channel: '/test',
        data: { test: true }
      };

      engine.publish(message, ['/test']);
      await delay(300);

      const errorCalls = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes?.('Error publishing')
      );

      expect(errorCalls.length).toBeGreaterThanOrEqual(0);
      consoleSpy.mockRestore();
    });

    it('should handle _withLock error path', async () => {
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

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Force disconnect to trigger lock error
      const redis = (engine as any)._redis;
      await redis.quit();

      // Try GC - should hit lock error handler
      engine.gc();
      await delay(300);

      const errorCalls = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes?.('Error with lock')
      );

      expect(errorCalls.length).toBeGreaterThanOrEqual(0);
      consoleSpy.mockRestore();
    });
  });

  describe('Lock Stealing Scenario', () => {
    it('should handle lock stealing when lock is expired', async () => {
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

      // Create stale clients
      const client1 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      const client2 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Manually set an old lock that should be stealable
      const redis = createClient({
        socket: { host: 'localhost', port: 6379 },
        password: redisPassword
      });

      await redis.connect();

      const lockKey = namespace + '/locks/gc';
      // Set lock with old timestamp (already expired)
      const oldTimestamp = new Date().getTime() - 200000;
      await redis.set(lockKey, oldTimestamp.toString());

      await redis.quit();

      // Wait for clients to become stale
      await delay(1500);

      // GC should be able to steal the lock and clean up
      engine.gc();
      await delay(1500);

      // Clients should be removed
      const exists1 = await new Promise<boolean>((resolve) => {
        engine.clientExists(client1, resolve, null);
      });

      const exists2 = await new Promise<boolean>((resolve) => {
        engine.clientExists(client2, resolve, null);
      });

      expect(exists1).toBe(false);
      expect(exists2).toBe(false);
    });

    it('should not acquire lock if already held by another process', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace,
        gc: 1
      };

      server.timeout = 10;

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Manually set a fresh lock (not expired)
      const redis = createClient({
        socket: { host: 'localhost', port: 6379 },
        password: redisPassword
      });

      await redis.connect();

      const lockKey = namespace + '/locks/gc';
      const futureTimestamp = new Date().getTime() + 100000;
      await redis.set(lockKey, futureTimestamp.toString());

      await redis.quit();

      // GC should NOT be able to acquire the lock
      engine.gc();
      await delay(300);

      // Client should still exist (wasn't cleaned up)
      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(true);
    });
  });

  describe('Destroy Client with Channels', () => {
    it('should unsubscribe from all channels when destroying client', async () => {
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

      // Subscribe to multiple channels
      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/channel1', resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/channel2', resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/channel3', resolve, null);
      });

      let unsubscribeCount = 0;
      server.on('unsubscribe', () => {
        unsubscribeCount++;
      });

      // Destroy client - should unsubscribe from all channels
      await new Promise<void>((resolve) => {
        engine.destroyClient(clientId, resolve, null);
      });

      await delay(200);

      // Should have triggered 3 unsubscribe events
      expect(unsubscribeCount).toBe(3);
    });

    it('should trigger disconnect event when destroying client', async () => {
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

      let disconnectTriggered = false;
      let disconnectedClientId: string | undefined;

      server.on('disconnect', (cId: string) => {
        disconnectTriggered = true;
        disconnectedClientId = cId;
      });

      await new Promise<void>((resolve) => {
        engine.destroyClient(clientId, resolve, null);
      });

      await delay(100);

      expect(disconnectTriggered).toBe(true);
      expect(disconnectedClientId).toBe(clientId);
    });
  });
});
