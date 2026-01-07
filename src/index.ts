// Backward compatibility entry point
// This file provides CommonJS compatibility while maintaining TypeScript benefits
//
// Usage patterns supported:
// - const Engine = require('faye-redis-ng');           (CommonJS direct)
// - const { Engine } = require('faye-redis-ng');       (CommonJS destructured)
// - import Engine from 'faye-redis-ng';                (ES6 default)
// - import { Engine } from 'faye-redis-ng';            (ES6 named)

import Engine from './faye-redis';

// Export as CommonJS default (for backward compatibility)
export = Engine;
