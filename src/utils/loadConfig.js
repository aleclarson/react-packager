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
const steal = require('steal');

const cache = Object.create(null);

function loadConfig(filePath, options = {}) {

  if (!options.force && cache[filePath]) {
    return cache[filePath];
  }

  const json = readJSON(filePath);

  const config = {
    host: steal(json, 'host'),
    port: steal(json, 'port'),
    transformer: steal(json, 'transformer'),
    assetRoots: steal(json, 'assetRoots'),
    redirect: steal(json, 'redirect'),
    blacklist: steal(json, 'blacklist'),
    whitelist: steal(json, 'whitelist'),
  };

  if (options.extraKeys) {
    options.extraKeys.forEach(key => {
      config[key] = steal(json, key);
    });
  }

  const badKeys = Object.keys(json);
  if (badKeys.length) {
    log.moat(1);
    log.white('Unrecognized config keys:');
    log.plusIndent(2);
    badKeys.forEach(key => {
      log.moat(0);
      log.red(key);
    });
    log.popIndent();
    log.moat(1);
    log.white('Config location: ');
    log.yellow(filePath);
    log.moat(1);
  }

  cache[filePath] = config;
  return config;
};

function readJSON(filePath) {
  if (fs.sync.exists(filePath)) {
    try {
      return JSON.parse(fs.sync.read(filePath));
    } catch(e) {
      log.moat(1);
      log.red('Error: ');
      log.white(e.message);
      log.moat(0);
      log.gray(lotus.relative(filePath));
      log.moat(1);
      return {};
    }
  }
  return {};
}

module.exports = loadConfig;
