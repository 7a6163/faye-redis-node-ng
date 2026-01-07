const redis = require('redis');

class Engine {
  constructor(server, options = {}) {
    this._server = server;
    this._options = options;

    this._ns = options.namespace || '';
    this._messageChannel = this._ns + '/notifications/messages';
    this._closeChannel = this._ns + '/notifications/close';

    // Initialize clients (will be connected in _initializeClients)
    this._redis = null;
    this._subscriber = null;
    this._initialized = false;

    // Start initialization
    this._initializeClients().catch(err => {
      console.error('Failed to initialize Redis clients:', err);
    });

    const gc = options.gc || this.DEFAULT_GC;
    this._gc = setInterval(() => this.gc(), gc * 1000);
  }

  async _initializeClients() {
    const host = this._options.host || this.DEFAULT_HOST;
    const port = this._options.port || this.DEFAULT_PORT;
    const db = this._options.database || this.DEFAULT_DATABASE;
    const auth = this._options.password;
    const socket = this._options.socket;

    const clientConfig = {
      database: db,
      ...(auth && { password: auth }),
      ...(socket && { socket: { path: socket, reconnectStrategy: this._reconnectStrategy.bind(this) } }),
      ...(!socket && { socket: { host, port, reconnectStrategy: this._reconnectStrategy.bind(this) } })
    };

    this._redis = redis.createClient(clientConfig);
    this._subscriber = redis.createClient(clientConfig);

    // Set up error handlers
    this._redis.on('error', (err) => {
      console.error('Redis client error:', err);
      this._server.trigger('error', err);
    });

    this._subscriber.on('error', (err) => {
      console.error('Redis subscriber error:', err);
      this._server.trigger('error', err);
    });

    // Handle reconnection events
    this._redis.on('reconnecting', () => {
      console.log('Redis client reconnecting...');
      this._initialized = false;
    });

    this._subscriber.on('reconnecting', () => {
      console.log('Redis subscriber reconnecting...');
      this._initialized = false;
    });

    this._redis.on('ready', () => {
      console.log('Redis client ready');
      this._initialized = true;
    });

    // Track if we've already set up subscriptions to prevent duplicates
    this._subscriptionsSetUp = false;

    this._subscriber.on('ready', async () => {
      console.log('Redis subscriber ready');
      // Only re-subscribe after reconnection (not on initial connection)
      if (this._subscriptionsSetUp) {
        console.log('Redis subscriber reconnected, re-subscribing...');
        try {
          await this._subscriber.subscribe(this._messageChannel, (message) => {
            this.emptyQueue(message);
          });
          await this._subscriber.subscribe(this._closeChannel, (message) => {
            this._server.trigger('close', message);
          });
          this._initialized = true;
        } catch (err) {
          console.error('Error re-subscribing after reconnection:', err);
        }
      }
    });

    await this._redis.connect();
    await this._subscriber.connect();

    // Initial subscription (only once)
    await this._subscriber.subscribe(this._messageChannel, (message) => {
      this.emptyQueue(message);
    });

    await this._subscriber.subscribe(this._closeChannel, (message) => {
      this._server.trigger('close', message);
    });

    this._subscriptionsSetUp = true;
    this._initialized = true;
  }

  _reconnectStrategy(retries) {
    // Exponential backoff with max delay of 10 seconds
    if (retries > 20) {
      // After 20 retries, give up (roughly 2 minutes)
      console.error('Redis reconnection failed after 20 retries');
      return new Error('Max reconnection attempts reached');
    }
    const delay = Math.min(retries * 100, 10000);
    console.log(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
    return delay;
  }

  async _waitForInit() {
    while (!this._initialized) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  static create(server, options) {
    return new this(server, options);
  }

  async disconnect() {
    await this._subscriber.unsubscribe();
    await this._redis.quit();
    await this._subscriber.quit();
    clearInterval(this._gc);
  }

  createClient(callback, context) {
    this._waitForInit().then(async () => {
      const clientId = this._server.generateId();
      const added = await this._redis.zAdd(this._ns + '/clients', {
        score: 0,
        value: clientId
      }, { NX: true });

      if (added === 0) {
        return this.createClient(callback, context);
      }

      this._server.debug('Created new client ?', clientId);
      this.ping(clientId);
      this._server.trigger('handshake', clientId);
      callback.call(context, clientId);
    }).catch(err => {
      console.error('Error creating client:', err);
    });
  }

  clientExists(clientId, callback, context) {
    this._waitForInit().then(async () => {
      const cutoff = new Date().getTime() - (1000 * 1.6 * this._server.timeout);
      const score = await this._redis.zScore(this._ns + '/clients', clientId);
      callback.call(context, score ? parseInt(score, 10) > cutoff : false);
    }).catch(err => {
      console.error('Error checking client existence:', err);
      callback.call(context, false);
    });
  }

  destroyClient(clientId, callback, context) {
    this._waitForInit().then(async () => {
      const channels = await this._redis.sMembers(this._ns + '/clients/' + clientId + '/channels');

      const multi = this._redis.multi();
      multi.zAdd(this._ns + '/clients', { score: 0, value: clientId });

      for (const channel of channels) {
        multi.sRem(this._ns + '/clients/' + clientId + '/channels', channel);
        multi.sRem(this._ns + '/channels' + channel, clientId);
      }

      multi.del(this._ns + '/clients/' + clientId + '/messages');
      multi.zRem(this._ns + '/clients', clientId);
      multi.publish(this._closeChannel, clientId);

      const results = await multi.exec();

      channels.forEach((channel, i) => {
        if (results[2 * i + 1] !== 1) return;
        this._server.trigger('unsubscribe', clientId, channel);
        this._server.debug('Unsubscribed client ? from channel ?', clientId, channel);
      });

      this._server.debug('Destroyed client ?', clientId);
      this._server.trigger('disconnect', clientId);

      if (callback) callback.call(context);
    }).catch(err => {
      console.error('Error destroying client:', err);
      if (callback) callback.call(context);
    });
  }

  ping(clientId) {
    const timeout = this._server.timeout;
    if (typeof timeout !== 'number') return;

    const time = new Date().getTime();

    this._server.debug('Ping ?, ?', clientId, time);
    this._waitForInit().then(async () => {
      await this._redis.zAdd(this._ns + '/clients', { score: time, value: clientId });
    }).catch(err => {
      console.error('Error pinging client:', err);
    });
  }

  subscribe(clientId, channel, callback, context) {
    this._waitForInit().then(async () => {
      const added = await this._redis.sAdd(this._ns + '/clients/' + clientId + '/channels', channel);
      if (added === 1) {
        this._server.trigger('subscribe', clientId, channel);
      }

      await this._redis.sAdd(this._ns + '/channels' + channel, clientId);
      this._server.debug('Subscribed client ? to channel ?', clientId, channel);
      if (callback) callback.call(context);
    }).catch(err => {
      console.error('Error subscribing:', err);
      if (callback) callback.call(context);
    });
  }

  unsubscribe(clientId, channel, callback, context) {
    this._waitForInit().then(async () => {
      const removed = await this._redis.sRem(this._ns + '/clients/' + clientId + '/channels', channel);
      if (removed === 1) {
        this._server.trigger('unsubscribe', clientId, channel);
      }

      await this._redis.sRem(this._ns + '/channels' + channel, clientId);
      this._server.debug('Unsubscribed client ? from channel ?', clientId, channel);
      if (callback) callback.call(context);
    }).catch(err => {
      console.error('Error unsubscribing:', err);
      if (callback) callback.call(context);
    });
  }

  publish(message, channels) {
    this._server.debug('Publishing message ?', message);

    this._waitForInit().then(async () => {
      const jsonMessage = JSON.stringify(message);
      const keys = channels.map(c => this._ns + '/channels' + c);

      const clients = await this._redis.sUnion(keys);

      for (const clientId of clients) {
        const queue = this._ns + '/clients/' + clientId + '/messages';

        this._server.debug('Queueing for client ?: ?', clientId, message);
        await this._redis.rPush(queue, jsonMessage);
        await this._redis.publish(this._messageChannel, clientId);

        const exists = await new Promise((resolve) => {
          this.clientExists(clientId, resolve, null);
        });

        if (!exists) {
          await this._redis.del(queue);
        }
      }

      this._server.trigger('publish', message.clientId, message.channel, message.data);
    }).catch(err => {
      console.error('Error publishing:', err);
    });
  }

  emptyQueue(clientId) {
    if (!this._server.hasConnection(clientId)) return;

    this._waitForInit().then(async () => {
      const key = this._ns + '/clients/' + clientId + '/messages';
      const multi = this._redis.multi();

      multi.lRange(key, 0, -1);
      multi.del(key);

      const results = await multi.exec();
      const jsonMessages = results[0];

      if (jsonMessages && jsonMessages.length > 0) {
        const messages = jsonMessages.map(json => JSON.parse(json));
        this._server.deliver(clientId, messages);
      }
    }).catch(err => {
      console.error('Error emptying queue:', err);
    });
  }

  gc() {
    const timeout = this._server.timeout;
    if (typeof timeout !== 'number') return;

    this._withLock('gc', async (releaseLock) => {
      const cutoff = new Date().getTime() - 1000 * 2 * timeout;

      const clients = await this._redis.zRangeByScore(this._ns + '/clients', 0, cutoff);

      if (clients.length === 0) {
        releaseLock();
        return;
      }

      let completed = 0;
      for (const clientId of clients) {
        this.destroyClient(clientId, () => {
          completed++;
          if (completed === clients.length) {
            releaseLock();
          }
        }, this);
      }
    });
  }

  _withLock(lockName, callback) {
    this._waitForInit().then(async () => {
      const lockKey = this._ns + '/locks/' + lockName;
      const currentTime = new Date().getTime();
      const expiry = currentTime + this.LOCK_TIMEOUT * 1000 + 1;

      const releaseLock = async () => {
        if (new Date().getTime() < expiry) {
          await this._redis.del(lockKey);
        }
      };

      const set = await this._redis.setNX(lockKey, expiry.toString());
      if (set) {
        return callback.call(this, releaseLock);
      }

      const timeout = await this._redis.get(lockKey);
      if (!timeout) return;

      const lockTimeout = parseInt(timeout, 10);
      if (currentTime < lockTimeout) return;

      const oldValue = await this._redis.set(lockKey, expiry.toString(), { GET: true });
      if (oldValue === timeout) {
        callback.call(this, releaseLock);
      }
    }).catch(err => {
      console.error('Error with lock:', err);
    });
  }
}

Engine.prototype.DEFAULT_HOST = 'localhost';
Engine.prototype.DEFAULT_PORT = 6379;
Engine.prototype.DEFAULT_DATABASE = 0;
Engine.prototype.DEFAULT_GC = 60;
Engine.prototype.LOCK_TIMEOUT = 120;

module.exports = Engine;
