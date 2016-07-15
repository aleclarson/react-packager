/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fs = require('io/sync');
const path = require('path');
const url = require('url');
const qs = require('querystring');

module.exports = function parseURLForBundleOptions(reqUrl) {
  // `true` to parse the query param as an object.
  const parsedUrl = url.parse(reqUrl, true);

  // node v0.11.14 bug see https://github.com/facebook/react-native/issues/218
  const query = parsedUrl.query || {};

  const dir = query.dir || '';
  const platform = query.platform;
  const pathname = decodeURIComponent(parsedUrl.pathname)
    .replace(/\.(bundle|map)$/, '')
    .slice(1);

  const entryFile = getEntryFile(dir, pathname, platform);

  const dev = boolFromQuery(query, 'dev', true);
  const minify = boolFromQuery(query, 'minify');
  const hot = boolFromQuery(query, 'hot', dev); // TODO: Set the default back to `false` when native defaults are used on app launch.
  const runModule = boolFromQuery(query, 'runModule', true);
  const inlineSourceMap = boolFromQuery(query, 'inlineSourceMap', false);
  const entryModuleOnly = boolFromQuery(query, 'entryModuleOnly', false);

  let sourceMapUrl = '/' + pathname + '.map?' + qs.stringify({platform, dev, hot});

  return {
    platform,
    entryFile,
    sourceMapUrl,
    dev,
    minify,
    hot,
    runModule,
    inlineSourceMap,
    entryModuleOnly,
  };
};

function getEntryFile(dir, name, platform) {
  let filePath = path.join(dir, name + '.' + platform + '.js');
  if (fs.isFile(filePath)) { return filePath }
  return path.join(dir, name + '.js');
}

function boolFromQuery(query, opt, defaultVal) {
  if (query[opt] == null && defaultVal != null) { return defaultVal }
  return query[opt] === 'true' || query[opt] === '1';
}
