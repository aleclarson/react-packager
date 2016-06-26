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

global.Promise = require('Promise');

global.fs = {
  sync: require('io/sync'),
  async: require('io/async'),
};

var path = require('path');
process.config = require('./dist/utils/Config')(
  path.resolve(lotus.path, 'react-packager.json')
);

var File = require('node-haste/lib/File');
lotus.file = new File(lotus.path, {
  isDir: true,
  isDetached: true,
});

require('node-haste/lib/fastpath').replace();
