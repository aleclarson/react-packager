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
  const filePath = urlObj.pathname.replace(/^\/watcher/, '');
  const fastfs = this._bundler.getFS();
  const {event} = urlObj.query || {};
  withValidChange(event, filePath, fastfs, (root) => {
    // Only process events for files that aren't already handled by the packager.
    if (this._fileWatcher._watcherByRoot[root.path] != null) {
      return;
    }
    this._fileWatcher.emit(
      'all',
      event,
      path.relative(root.path, filePath),
      root.path,
      event !== 'delete' && fs.sync.stats(filePath),
    );
  });
}

// Calls `next` when `filePath` is considered valid.
function withValidChange(event, filePath, fastfs, next) {
  const root = fastfs._getRoot(filePath);
  if (!root) {
    return;
  }
  if (event === 'add') {
    if (fs.sync.exists(filePath)) {
      next(root);
    }
  } else if (fastfs._fastPaths[filePath]) {
    if (event === 'delete') {
      next(root);
    } else if (fs.sync.exists(filePath)) {
      next(root);
    }
  }
}
