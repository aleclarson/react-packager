/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const sharedWhitelist = [
  'react-native/node_modules/react-timer-mixin/**',
  'react/src/renderers/dom/client/syntheticEvents/SyntheticEvent.js',
  'react/src/test/ReactPerf.js',
];

const mm = require('micromatch');

function whitelist(patterns) {
  patterns = patterns ? patterns.concat(sharedWhitelist) : sharedWhitelist;
  return mm.makeRe('**/(' + patterns.join('|') + ')');
}

module.exports = whitelist;
