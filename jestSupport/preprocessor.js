/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const createCacheKeyFunction = require('fbjs-scripts/jest/createCacheKeyFunction');
const defaultTransform = require('./defaultTransform');
const path = require('path');

module.exports = {
  process(src, file) {
    // Don't transform node_modules, except react-tools which includes the
    // untransformed copy of React
    if (file.match(/node_modules\/(?!react-tools\/)/)) {
      return src;
    }

    return defaultTransform.transform(src, file, {inlineRequires: true}).code;
  },

  getCacheKey: createCacheKeyFunction([
    __filename,
    path.join(__dirname, 'defaultTransform.js'),
    require.resolve('babel-core/package.json'),
  ]),
};
