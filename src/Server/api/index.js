/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

module.exports = {
  '*.bundle': require('./readBundle'),
  '*.map': require('./readMap'),
  '*.assets': require('./readAssets'),
  'read/**': require('./readFile'),
  'assets/**': require('./readAsset'),
  'watcher/**': require('./emitChange'),
  'onchange': require('./onChange'),
  'profile': require('./dumpProfileInfo'),
  'reset/bundles': resetBundles,
};

function resetBundles() {

  // Clear current Bundle promise.
  this._bundling = null;

  // Clear cached Bundle instances.
  this._bundles = Object.create(null);

  // Clear cached ResolutionResponse instances.
  this._resolver._responseCache = Object.create(null);

  log.moat(1);
  log.white('Reset all bundles.');
  log.moat(1);
}
