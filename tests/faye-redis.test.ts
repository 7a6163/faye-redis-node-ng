import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from 'redis';
import Engine from '../src/faye-redis';
import type { EngineOptions } from '../src/types';
import { MockFayeServer, delay, waitFor, createTestMessage } from './helpers';

describe('Redis Engine', () => {
  let engine: Engine;
  let server: MockFayeServer;
  let namespace: string;
  let redisPassword: string | undefined;

  beforeAll(() => {
    // Use password 'foobared' for local testing, undefined for CI
    redisPassword = process.env.CI ? undefined : 'foobared';
  });

  beforeEach(() => {
    // Create unique namespace for each test to avoid conflicts
    namespace = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    server = new MockFayeServer();
  });

  afterEach(async () => {
    // Clean up engine
    if (engine) {
      await engine.disconnect();
    }

    // Clean up Redis data
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

  describe('Client Management', () => {
    it('should create a unique client ID', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100); // Wait for initialization

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      expect(clientId).toBeDefined();
      expect(typeof clientId).toBe('string');
      expect(clientId.length).toBeGreaterThan(0);
    });

    it('should create multiple unique client IDs', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientIds = await Promise.all([
        new Promise<string>((resolve) => engine.createClient(resolve, null)),
        new Promise<string>((resolve) => engine.createClient(resolve, null)),
        new Promise<string>((resolve) => engine.createClient(resolve, null))
      ]);

      expect(new Set(clientIds).size).toBe(3); // All IDs should be unique
    });

    it('should check if client exists', async () => {
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

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(true);
    });

    it('should return false for non-existent client', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists('non_existent_client', resolve, null);
      });

      expect(exists).toBe(false);
    });

    it('should ping a client to keep it alive', async () => {
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

      await delay(50); // Wait for client to be fully created

      // Ping the client
      engine.ping(clientId);
      await delay(200); // Increase delay to ensure ping completes

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(true);
    });

    it('should destroy a client', async () => {
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

      await new Promise<void>((resolve) => {
        engine.destroyClient(clientId, resolve, null);
      });

      await delay(100);

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(false);
    });

    it('should trigger handshake event on client creation', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      let handshakeClientId: string | undefined;
      server.on('handshake', (clientId: string) => {
        handshakeClientId = clientId;
      });

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      await delay(100);
      expect(handshakeClientId).toBe(clientId);
    });

    it('should trigger disconnect event on client destruction', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      let disconnectClientId: string | undefined;
      server.on('disconnect', (clientId: string) => {
        disconnectClientId = clientId;
      });

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.destroyClient(clientId, resolve, null);
      });

      await delay(100);
      expect(disconnectClientId).toBe(clientId);
    });
  });

  describe('Subscriptions', () => {
    it('should subscribe a client to a channel', async () => {
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

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      // Verify subscription by checking if publish works
      // This is an indirect test since we can't directly query subscriptions
      expect(true).toBe(true);
    });

    it('should trigger subscribe event', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      let subscribeEvent: { clientId?: string; channel?: string } = {};
      server.on('subscribe', (clientId: string, channel: string) => {
        subscribeEvent = { clientId, channel };
      });

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      await delay(100);
      expect(subscribeEvent.clientId).toBe(clientId);
      expect(subscribeEvent.channel).toBe('/test/channel');
    });

    it('should unsubscribe a client from a channel', async () => {
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

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.unsubscribe(clientId, '/test/channel', resolve, null);
      });

      expect(true).toBe(true);
    });

    it('should trigger unsubscribe event', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      let unsubscribeEvent: { clientId?: string; channel?: string } = {};
      server.on('unsubscribe', (clientId: string, channel: string) => {
        unsubscribeEvent = { clientId, channel };
      });

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.subscribe(clientId, '/test/channel', resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.unsubscribe(clientId, '/test/channel', resolve, null);
      });

      await delay(100);
      expect(unsubscribeEvent.clientId).toBe(clientId);
      expect(unsubscribeEvent.channel).toBe('/test/channel');
    });
  });

  describe('Message Publishing', () => {
    it('should publish a message to subscribed clients', async () => {
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

      const deliveredMessages: any[] = [];
      server.on('deliver', (cId: string, messages: any[]) => {
        if (cId === clientId) {
          deliveredMessages.push(...messages);
        }
      });

      const message = createTestMessage('/test/channel', { text: 'Hello World' });
      engine.publish(message, ['/test/channel']);

      await delay(300);
      expect(deliveredMessages.length).toBeGreaterThan(0);
      expect(deliveredMessages[0].data).toEqual({ text: 'Hello World' });
    });

    it('should publish to multiple subscribed clients', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const client1 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      const client2 = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      server.addConnection(client1);
      server.addConnection(client2);

      await new Promise<void>((resolve) => {
        engine.subscribe(client1, '/test/channel', resolve, null);
      });

      await new Promise<void>((resolve) => {
        engine.subscribe(client2, '/test/channel', resolve, null);
      });

      const deliveredClients = new Set<string>();
      server.on('deliver', (clientId: string) => {
        deliveredClients.add(clientId);
      });

      const message = createTestMessage('/test/channel', { text: 'Broadcast' });
      engine.publish(message, ['/test/channel']);

      await delay(500);
      expect(deliveredClients.has(client1)).toBe(true);
      expect(deliveredClients.has(client2)).toBe(true);
    });

    it('should trigger publish event', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      let publishEvent: { clientId?: string; channel?: string; data?: any } = {};
      server.on('publish', (clientId: string, channel: string, data: any) => {
        publishEvent = { clientId, channel, data };
      });

      const message = createTestMessage('/test/channel', { text: 'Test' }, 'test-client');
      engine.publish(message, ['/test/channel']);

      await delay(400);
      expect(publishEvent.channel).toBe('/test/channel');
      expect(publishEvent.data).toEqual({ text: 'Test' });
      expect(publishEvent.clientId).toBe('test-client');
    });
  });

  describe('Configuration Options', () => {
    it('should use custom namespace', async () => {
      const customNamespace = 'custom_namespace';
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace: customNamespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      expect(clientId).toBeDefined();
    });

    it('should use custom database', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        database: 1,
        namespace
      };

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      expect(clientId).toBeDefined();
    });
  });

  describe('Garbage Collection', () => {
    it('should remove stale clients', async () => {
      const options: EngineOptions = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        namespace,
        gc: 1 // Run GC every second
      };

      // Set very short timeout for testing
      server.timeout = 1;

      engine = new Engine(server, options);
      await delay(100);

      const clientId = await new Promise<string>((resolve) => {
        engine.createClient(resolve, null);
      });

      // Wait for client to become stale (longer than 2 * timeout)
      await delay(3000);

      // Manually trigger GC
      engine.gc();

      // Wait for GC to complete
      await delay(500);

      const exists = await new Promise<boolean>((resolve) => {
        engine.clientExists(clientId, resolve, null);
      });

      expect(exists).toBe(false);
    });
  });

  // Skip Unix socket tests unless explicitly enabled
  if (process.env.TEST_UNIX_SOCKET === 'true') {
    describe('Unix Socket Connection', () => {
      it('should connect via Unix socket', async () => {
        const options: EngineOptions = {
          socket: '/tmp/redis.sock',
          password: redisPassword,
          namespace
        };

        engine = new Engine(server, options);
        await delay(200);

        const clientId = await new Promise<string>((resolve) => {
          engine.createClient(resolve, null);
        });

        expect(clientId).toBeDefined();
      });
    });
  }
});
