# Changelog

All notable changes to faye-redis-ng will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-01-07

### Fixed
- **Critical**: Fixed `clientExists` method parameter order from `(callback, context, clientId)` to `(clientId, callback, context)` to match original faye-redis API
  - This was causing "Invalid argument type" errors in Redis operations
  - Also fixed internal call in `publish` method to use correct parameter order

### Changed
- **Node.js requirement**: Updated from `>=14.0.0` to `>=22.0.0` (LTS)
  - Now requires Node.js 22 LTS for long-term support and modern features

## [1.0.0] - 2026-01-07

### 🎉 Initial Release of faye-redis-ng

This is the first release of **faye-redis-ng** (Next Generation), a modern fork of the original faye-redis with significant improvements while maintaining 100% backward compatibility.

### Added
- **Redis v4 support** with modern Promise-based API
- **Automatic reconnection** with exponential backoff strategy
  - Retries with delays: 100ms, 200ms, 300ms ... up to 10s
  - Max 20 retries (~2 minutes) before giving up
  - Auto re-subscribe to pub/sub channels after reconnection
- **ES6+ class syntax** replacing prototype-based patterns
- **Comprehensive error handling** with error event triggers
- **Connection state tracking** via `_initialized` flag
- **Modern JavaScript features**: const/let, arrow functions, async/await, spread operators
- **Better logging** for debugging and monitoring
- **Integration tests** independent of Faye vendor submodule
- **Comprehensive documentation**: README, CLAUDE.md, REFACTORING.md, NPM_PUBLISH.md

### Changed
- **Package name**: `faye-redis` → `faye-redis-ng`
- **Version**: Starting at 1.0.0 for NG fork
- **Node.js requirement**: `>=0.4.0` → `>=22.0.0` (LTS)
- **Redis client**: Upgraded to v4 Promise-based API
- **Code structure**: Prototype-based → ES6 class
- **Internal implementation**: Callbacks → async/await

### Improved
- Production-ready reliability with automatic reconnection
- Better error messages with contextual information
- Code maintainability with modern JavaScript patterns
- Testing with standalone integration test suite

### Fixed
- Git submodule URL changed from `git://` to `https://`
- Deprecated `getset` command replaced with modern API
- Connection loss scenarios now handled gracefully

### Migration from Original faye-redis

**Drop-in replacement** - just update package name:

```bash
npm uninstall faye-redis
npm install faye-redis-ng
```

Change require statement:
```javascript
const redis = require('faye-redis-ng');
```

That's it! No other changes needed.

---

## Original faye-redis History

Below is the changelog from the original [faye-redis](https://github.com/faye/faye-redis-node) project by James Coglan.

### 0.2.0 / 2013-10-01

* Trigger the `close` event as required by Faye 1.0

### 0.1.3 / 2013-05-11

* Fix a bug due to a misuse of `this`

### 0.1.2 / 2013-04-28

* Improve garbage collection to avoid leaking Redis memory

### 0.1.1 / 2012-07-15

* Fix an implicit global variable leak (missing semicolon)

### 0.1.0 / 2012-02-26

* Initial release: Redis backend for Faye 0.8
