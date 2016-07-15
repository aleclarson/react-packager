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

module.exports = function readBundle(req, res) {
  const options = parseURLForBundleOptions(req.url);
  return this.buildBundle(
    JSON.stringify(options),
    options,
  ).then(bundle => {
    // An error was thrown while bundling.
    if (!bundle) {
      return;
    }

    const bundleSource = bundle.getSource({
      inlineSourceMap: options.inlineSourceMap,
      minify: options.minify,
      dev: options.dev,
    });

    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('ETag', bundle.getEtag());

    if (req.headers['if-none-match'] === res.getHeader('ETag')){
      res.statusCode = 304;
      return;
    }

    return bundleSource;
  });
}
