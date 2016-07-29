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
const path = require('path');
const url = require('url');

module.exports = function emitChange(req, res) {
  const urlObj = url.parse(req.url, true);
  const query = urlObj.query || {};

  const filePath = urlObj.pathname.replace(/^\/watcher/, '');
  if (!fs.sync.exists(filePath)) {
    return;
  }

  const fastfs = this._bundler.getFS();

  if (query.event === 'add') {
    // Always accept 'add' events.
  } else if (query.force === 'true') {
    // Allow emitting a change forcefully. (may result in error)
  } else if (fastfs._fastPaths[filePath]) {
    // The file path should be cached by a bundle.
  } else {
    return;
  }

  const root = fastfs._getRoot(filePath);
  if (!root) {
    log.moat(1);
    log.white('Invalid root: ');
    log.red(filePath);
    log.moat(1);
    return;
  }

  // Only process events for files that aren't already handled by the packager.
  if (this._fileWatcher._watcherByRoot[root.path] != null) {
    return;
  }

  this._fileWatcher.emit(
    'all',
    query.event,
    path.relative(root.path, filePath),
    root.path,
    query.event !== 'delete' && fs.sync.stats(filePath),
  );
}
