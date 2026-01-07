# faye-redis-ng

![NPM Version](https://img.shields.io/npm/v/faye-redis-ng)
[![Node.js Version](https://img.shields.io/node/v/faye-redis-ng.svg)](https://nodejs.org)
[![CI](https://github.com/7a6163/faye-redis-node-ng/workflows/CI/badge.svg)](https://github.com/7a6163/faye-redis-node-ng/actions)
[![codecov](https://codecov.io/gh/7a6163/faye-redis-node-ng/branch/master/graph/badge.svg)](https://codecov.io/gh/7a6163/faye-redis-node-ng)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Next Generation** Redis backend engine for [Faye](http://faye.jcoglan.com) - A modern, maintained fork with Redis v4 support, ES6+ syntax, and automatic reconnection.

## 🎉 What's New in NG (Next Generation)

This is a modernized fork of the original [faye-redis](https://github.com/7a6163/faye-redis-node) with significant improvements:

### ✨ Key Improvements

- ✅ **TypeScript Support** - Full TypeScript rewrite with type definitions
- ✅ **Redis v4 Support** - Uses modern Promise-based Redis client API
- ✅ **ES6+ Syntax** - Modern JavaScript with classes, async/await, const/let
- ✅ **Auto-Reconnection** - Automatic Redis reconnection with exponential backoff
- ✅ **Better Error Handling** - Comprehensive error logging and event triggers
- ✅ **Node.js 22 LTS** - Updated for latest LTS Node.js version
- ✅ **Modern Testing** - Vitest with 77%+ code coverage
- ✅ **Zero Breaking Changes** - Drop-in replacement for original faye-redis

### 🔄 Why This Fork?

The original `faye-redis` hasn't been updated since 2015 and uses deprecated dependencies. This fork brings it up to modern standards while maintaining 100% backward compatibility.

## Installation

```bash
npm install faye-redis-ng
```

## Usage

This is a **drop-in replacement** for the original `faye-redis`. Simply change the require statement:

```js
// Before (old faye-redis)
const redis = require('faye-redis');

// After (faye-redis-ng)
const redis = require('faye-redis-ng');
```

Complete example:

```js
const faye = require('faye');
const redis = require('faye-redis-ng');
const http = require('http');

const server = http.createServer();

const bayeux = new faye.NodeAdapter({
  mount: '/',
  timeout: 25,
  engine: {
    type: redis,
    host: 'redis.example.com',
    port: 6379,
    password: 'your-password', // optional
    namespace: 'faye',         // optional
    database: 0                // optional
  }
});

bayeux.attach(server);
server.listen(8000);
```

## Configuration Options

All original configuration options are supported:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | String | `'localhost'` | Redis server hostname |
| `port` | Number | `6379` | Redis server port |
| `password` | String | `undefined` | Redis password (if `requirepass` is set) |
| `database` | Number | `0` | Redis database number |
| `namespace` | String | `''` | Prefix for all Redis keys (allows multiple Faye instances) |
| `socket` | String | `undefined` | Unix socket path (alternative to host/port) |
| `gc` | Number | `60` | Garbage collection interval in seconds |

## New Features

### Automatic Reconnection

The NG version includes production-ready reconnection handling:

- **Exponential backoff**: 100ms, 200ms, 300ms ... up to 10s
- **Max retries**: 20 attempts (~2 minutes) before giving up
- **Auto re-subscribe**: Pub/sub channels automatically re-subscribed after reconnection
- **State tracking**: Operations pause during reconnection and resume when ready

Example reconnection logs:
```
Redis reconnecting in 100ms (attempt 1)
Redis reconnecting in 200ms (attempt 2)
...
Redis subscriber ready
Redis client ready
```

### Better Error Handling

All connection errors are logged and trigger events to your Faye server:

```js
bayeux.bind('error', function(error) {
  console.error('Redis error:', error);
});
```

## Migrating from faye-redis

**No code changes required!** Just update your package.json:

```bash
npm uninstall faye-redis
npm install faye-redis-ng
```

Update your require statement and you're done:

```js
const redis = require('faye-redis-ng');
```

## Requirements

- **Node.js**: >= 22.0.0 (LTS)
- **Redis**: >= 2.8.0 (tested with Redis 6.x and 7.x)
- **Faye**: >= 1.0.0

## Architecture

This engine implements the Faye engine interface and uses Redis for:

- **Client storage**: Sorted set with last-ping timestamps
- **Subscriptions**: Sets tracking client-channel relationships
- **Message queues**: Lists storing queued messages per client
- **Pub/Sub**: Channels for message notifications and client disconnections
- **Distributed locking**: For garbage collection coordination

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation.

## Development

```bash
# Install dependencies (includes Faye submodule)
make prepare

# Run tests (requires Redis server running)
npm test

# Or run integration tests
node test-integration.js
```

## Testing

The test suite requires a running Redis server. For local development:

```bash
# Start Redis with password
redis-server --requirepass foobared

# Run tests
npm test
```

## Changes from Original

See [REFACTORING.md](./REFACTORING.md) for complete details on modernization changes.

**Summary**:
- Upgraded from callback-based Redis to Promise-based Redis v4
- Converted from prototype-based to ES6 class syntax
- Added automatic reconnection with exponential backoff
- Modern JavaScript: const/let, arrow functions, async/await
- Improved error handling and logging
- Updated all dependencies to current versions

## Credits

- **Original Author**: [James Coglan](http://jcoglan.com/) - Created the original faye-redis
- **This Fork**: Modernized and maintained by the community

## License

MIT License - Same as the original faye-redis

## Contributing

Contributions are welcome! This is a community-maintained fork. Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## Related Projects

- [Faye](http://faye.jcoglan.com/) - Simple pub/sub messaging for the web
- [Redis](https://redis.io/) - In-memory data structure store

## Support

- **Issues**: [GitHub Issues](http://github.com/7a6163/faye-redis-node/issues)
- **Original Project**: [faye-redis](https://github.com/faye/faye-redis-node)

---

**Made with ❤️ by the community** | Keeping faye-redis modern and maintained
