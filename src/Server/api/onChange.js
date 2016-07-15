/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

module.exports = function processOnChangeRequest(req, res) {
  const watchers = this._changeWatchers;

  watchers.push({
    req: req,
    res: res,
  });

  req.on('close', () => {
    for (let i = 0; i < watchers.length; i++) {
      if (watchers[i] && watchers[i].req === req) {
        watchers.splice(i, 1);
        break;
      }
    }
  });

  res.keepAlive = true;
}
