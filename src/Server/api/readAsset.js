/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const url = require('url');

module.exports = function readSpecificAsset(req, res) {
  const urlObj = url.parse(req.url, true);
  const query = urlObj.query || {};
  const assetPath = urlObj.pathname.match(/^\/assets(\/.+)$/);
  return this._assetServer
    .get(assetPath[1], query.platform)
    .fail(error => {
      console.error(error.stack);
      res.writeHead('404');
      return 'Asset not found';
    });
}
