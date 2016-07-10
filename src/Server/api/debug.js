/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

function debugBundles(req, res) {
  let ret = '<!doctype html>';
  ret += '<h1> Cached Bundles </h1>';
  const hashes = Object.keys(this._bundles);
  Promise.map(hashes, (hash) => {
    return this._bundles[hash].then(p => {
      ret += '<div><h2>' + hash + '</h2>';
      ret += p.getDebugInfo();
    });
  }).then(
    () => res.end(ret),
    e => {
      res.writeHead(500);
      res.end('Internal Error');
      console.log(e.stack);
    }
  );
}

function debugGraph(req, res) {
  let ret = '<!doctype html>';
  ret += '<h1> Dependency Graph </h2>';
  ret += this._bundler.getGraphDebugInfo();
  res.end(ret);
}

module.exports = {
  bundles: debugBundles,
  graph: debugGraph,
};
