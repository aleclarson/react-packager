/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

// Don't forget to everything listed here to `package.json`
// modulePathIgnorePatterns.
const sharedBlacklist = [
  'react/src/test/**',
  // 'react/src/renderers/dom/**',
  'react/src/React.js',
  'react/src/renderers/dom/ReactDOM.js',

  // For each of these fbjs files (especially the non-forks/stubs), we should
  // consider deleting the conflicting copy and just using the fbjs version.
  //
  // fbjs forks:
  'fbjs/src/__forks__/Promise.js',
  'fbjs/src/__forks__/URI.js',
  'fbjs/src/__forks__/fetch.js',
  // fbjs stubs:
  'fbjs/src/stubs/ErrorUtils.js',
  // fbjs modules:
  'fbjs/src/core/dom/**',
  'fbjs/src/core/Deferred.js',
  'fbjs/src/core/PromiseMap.js',
  'fbjs/src/core/areEqual.js',
  'fbjs/src/core/emptyFunction.js',
  'fbjs/src/core/flattenArray.js',
  'fbjs/src/core/isEmpty.js',
  'fbjs/src/core_windowless/removeFromArray.js',
  'fbjs/src/core/resolveImmediate.js',
  'fbjs/src/core/sprintf.js',
  'fbjs/src/crypto/base62.js',
  'fbjs/src/crypto/crc32.js',
  'fbjs/src/fetch/fetchWithRetries.js',
  'fbjs/src/functional/everyObject.js',
  'fbjs/src/functional/filterObject.js',
  'fbjs/src/functional/forEachObject.js',
  'fbjs/src/functional/someObject.js',
  'fbjs/src/request/xhrSimpleDataSerializer.js',
  'fbjs/src/useragent/UserAgent.js',
  'fbjs/src/utils/nullthrows.js',
];

const mm = require('micromatch');

module.exports = function(patterns) {
  patterns = patterns ? patterns.concat(sharedBlacklist) : sharedBlacklist;
  return mm.makeRe('**/(' + patterns.join('|') + ')');
};
