/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fs = require('io');
const url = require('url');

module.exports = function readFile(req, res) {
  const urlObj = url.parse(req.url, true);
  const filePath = urlObj.pathname.replace(/^\/read/, '');
  return fs.async.read(filePath)
  .fail(error => {
    res.writeHead(500);
    if (error.code === 'ENOENT') {
      return '"' + filePath + '" doesnt exist.';
    }
    return error.message;
  });
}
