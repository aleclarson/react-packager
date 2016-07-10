/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

global.lotus = require(process.env.LOTUS_PATH + '/lotus');
global.log = require('log');

// graceful-fs helps on getting an error when we run out of file
// descriptors. When that happens it will enqueue the operation and retry it.
require('graceful-fs').gracefulify(
  require('fs')
);

// Replaces many helpers in the 'path' stdlib.
require('node-haste/fastpath').replace();
