/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

require('babel-polyfill');

var fs = require('fs');
var path = require('path');

function readBabelRC() {
  var rcpath = path.join(__dirname, '.babelrc');
  var source = fs.readFileSync(rcpath);
  return JSON.parse(
    source.toString()
  );
}

module.exports = function() {
  var config = readBabelRC();
  require('babel-register')(config);
}
