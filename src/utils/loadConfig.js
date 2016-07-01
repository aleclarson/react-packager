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

const Blacklist = require('./blacklist');
const Whitelist = require('./whitelist');

const cache = Object.create(null);

module.exports = function loadConfig(filePath) {

  if (Config._cache[filePath]) {
    return Config._cache[filePath];
  }

  const config = {
    path: filePath,
    reload: reloadConfig,
  };

  return cache[filePath] = config.reload();
};

function reloadConfig() {
  let json;
  if (fs.sync.exists(this.path)) {
    json = JSON.parse(fs.sync.read(this.path));
  } else {
    json = {};
  }

  // Support custom extensions.
  this.projectExts = json.projectExts || ['js', 'jsx', 'json'];
  this.assetExts = json.assetExts || ['png'];

  // Support global path redirection.
  this.redirect = json.redirect || Object.create(null);

  const whitelistRE = Whitelist(json.whitelist);
  this.whitelist = (filePath) => whitelistRE.test(filePath);

  const blacklistRE = Blacklist(json.blacklist);
  this.blacklist = (filePath) =>
    !this.whitelist(filePath) && blacklistRE.test(filePath);

  return this;
}
