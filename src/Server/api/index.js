/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const debug = require('./debug');

module.exports = {
  '*.bundle': require('./readBundle'),
  '*.map': require('./readMap'),
  '*.assets': require('./readAssets'),
  'read/**': require('./readFile'),
  'assets/**': require('./readAsset'),
  'watcher/**': require('./emitChange'),
  'onchange': require('./onChange'),
  'profile': require('./dumpProfileInfo'),
  'debug/bundles': debug.bundles,
  'debug/graph': debug.graph,
  'resetBundles': function (req, res) {
    this._bundling = null;
    this._bundles = Object.create(null);
    log.moat(1);
    log.white('Reset all bundles.');
    log.moat(1);
  }
};
