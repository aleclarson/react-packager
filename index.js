/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

global.lotus = require('lotus-require');

// Unless the module is inside 'node_modules',
// prefer forked modules before any 'node_modules'.
lotus.register({exclude: ['/node_modules/']});

require('ReactiveVar'); // Property({ reactive: true })
require('LazyVar');     // Property({ lazy: Function })
require('Event');       // Builder.prototype.defineEvents()

// Expose a global logger.
global.log = require('log');

// graceful-fs helps on getting an error when we run out of file
// descriptors. When that happens it will enqueue the operation and retry it.
require('graceful-fs').gracefulify(require('fs'));

// Replaces many helpers in the 'path' NodeJS lib.
require('node-haste/fastpath').replace();

module.exports = require('./js/index');
