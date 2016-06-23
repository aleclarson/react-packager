/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const platformBlacklists = {
  web: '*.(ios|android).*',
  ios: '*.(web|android).*',
  android: '*.(web|ios).*',
};

const mm = require('micromatch');

module.exports = (platform) => {
  const blacklist = platformBlacklists[platform];
  return blacklist && mm.makeRe('**/' + blacklist);
};
