/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const parseURLForBundleOptions = require('../utils/parseURLForBundleOptions');

module.exports = function readMap(req, res) {
  const options = parseURLForBundleOptions(req.url);

  const hash = JSON.stringify(options);
  if (!this._bundles[hash]) {
    log.moat(1);
    log.red('Error: ');
    log.white('Failed to find sourcemap for bundle: ');
    log.yellow(hash);
    log.moat(1);
    return;
  }
  return this.buildBundle(hash, options)
  .then(bundle => {
    // An error was thrown while bundling.
    if (!bundle) {
      return;
    }
    let sourceMap = bundle.getSourceMap({
      minify: options.minify,
      dev: options.dev,
    });
    if (typeof sourceMap !== 'string') {
      sourceMap = JSON.stringify(sourceMap);
    }
    res.setHeader('Content-Type', 'application/json');
    return sourceMap;
  });
}
