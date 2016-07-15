/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const path = require('path');
const fs = require('io');

const Blacklist = require('./blacklist');
const Whitelist = require('./whitelist');

function Config(filePath) {

  if (Config._cache[filePath]) {
    return Config._cache[filePath];
  }

  if (!fs.sync.isFile(filePath)) {
    const error = Error('"' + filePath + '" is not a file that exists.');
    error.code = 404;
    throw error;
  }

  const self = Object.create(Config.prototype);

  self.path = filePath;
  self.reload();

  return Config._cache[filePath] = self;
}

Config._cache = Object.create(null);

Config.prototype = {

  reload() {
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
  },

  // Resolves a non-absolute path into an absolute path.
  // Relative to the directory that this Config resides in.
  resolve(modulePath) {
    return path.isAbsolute(modulePath) ? modulePath :
      lotus.resolve(modulePath, this.path);
  },

  relative(modulePath) {
    return path.resolve(path.dirname(this.path), modulePath);
  }
};

module.exports = Config;
