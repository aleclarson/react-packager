/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const {buildBundle, buildBundleForHMR, buildPrepackBundle, rebuildBundles} = require('./utils/buildBundle');
const {getDependencies, getShallowDependencies, getOrderedDependencyPaths} = require('./utils/getDependencies');
const {FileWatcher} = require('node-haste');
const {isMatch} = require('micromatch');

const _ = require('underscore');
const AssetServer = require('../AssetServer');
const Bundle = require('../Bundler/Bundle');
const Bundler = require('../Bundler');
const Promise = require('Promise');
const parseURLForBundleOptions = require('./utils/parseURLForBundleOptions');
const declareOpts = require('../utils/declareOpts');
const path = require('path');
const steal = require('steal');
const url = require('url');

const endpoints = require('./api');

const serverOpts = declareOpts({
  fileWatcher: {
    type: 'object',
    required: true,
  },
  lazyRoots: {
    type: 'array',
    required: false,
  },
  projectRoots: {
    type: 'array',
    required: true,
  },
  projectExts: {
    type: 'array',
    required: true,
  },
  assetRoots: {
    type: 'array',
    default: [],
  },
  assetExts: {
    type: 'array',
    default: [],
  },
  blacklist: {
    type: 'function',
    required: false,
  },
  redirect: {
    type: 'object',
    required: false,
  },
  moduleFormat: {
    type: 'string',
    default: 'haste',
  },
  polyfillModuleNames: {
    type: 'array',
    default: [],
  },
  cacheVersion: {
    type: 'string',
    default: '1.0',
  },
  resetCache: {
    type: 'boolean',
    default: false,
  },
  transformModulePath: {
    type:'string',
    required: false,
  },
  transformTimeoutInterval: {
    type: 'number',
    required: false,
  },
  getTransformOptionsModulePath: {
    type: 'string',
    required: false,
  },
  disableInternalTransforms: {
    type: 'boolean',
    default: false,
  },
});

function Server(options) {
  const opts = serverOpts(options);

  this._bundling = null;
  this._bundles = Object.create(null);
  this._changeWatchers = [];
  this._fileChangeListeners = [];

  this._fileWatcher = opts.fileWatcher;
  this._fileWatcher.on('all', this._processFileChange.bind(this));

  this._assetServer = new AssetServer({
    roots: opts.projectRoots.concat(opts.assetRoots),
    extensions: opts.assetExts,
  });

  const bundlerOpts = Object.create(opts);
  bundlerOpts.fileWatcher = this._fileWatcher;
  bundlerOpts.assetServer = this._assetServer;
  this._bundler = new Bundler(bundlerOpts);

  this._debouncedFileChangeHandler = _.debounce(filePath => {
    this._bundles = Object.create(null); // TODO: Only reset bundles that use the given `filePath`!
    this._informChangeWatchers();
  }, 50);
}

Server.prototype = {

  buildBundle,

  buildBundleForHMR,

  buildPrepackBundle,

  rebuildBundles,

  getDependencies,

  getShallowDependencies,

  getOrderedDependencyPaths,

  setHMRFileChangeListener(listener) {
    this._hmrFileChangeListener = listener;
  },

  getModuleForPath(entryFile) {
    return this._bundler.getModuleForPath(entryFile);
  },

  middleware() {
    return this._processRequest.bind(this);
  },

  end() {
    return Promise.all([
      this._fileWatcher.end(),
      this._bundler.kill(),
    ]);
  },

  _processRequest(req, res, next) {
    const urlObj = url.parse(req.url, true);
    const pathname = urlObj.pathname.slice(1);

    let endpoint = null;
    for (let pattern in endpoints) {
      if (isMatch(pathname, pattern)) {
        endpoint = endpoints[pattern];
        break;
      }
    }
    if (typeof endpoint !== 'function') {
      return next();
    }

    Promise.try(() => endpoint.call(this, req, res))

    .then(value => {
      if (res.keepAlive) { return; }
      res.end(value);
    })

    .fail(error => {
      res.writeHead(error.status || 500, {
        'Content-Type': 'application/json; charset=UTF-8',
      });

      if (error.type === 'TransformError' ||
          error.type === 'NotFoundError' ||
          error.type === 'UnableToResolveError') {
        error.errors = [{
          description: error.description,
          filename: error.filename,
          lineNumber: error.lineNumber,
        }];
        res.end(JSON.stringify(error));
      } else {
        log.moat(1);
        log.white(error.stack);
        log.moat(1);
        res.end(JSON.stringify({
          type: 'InternalError',
          message: 'react-packager has encountered an internal error, ' +
            'please check your terminal error output for more details',
        }));
      }
    });
  },

  _processFileChange(type, filePath, root) {
    const absPath = path.join(root, filePath);
    this._bundler._processFileChange(type, filePath, root);

    // If Hot Loading is enabled avoid rebuilding bundles and sending live
    // updates. Instead, send the HMR updates right away and clear the bundles
    // cache so that if the user reloads we send them a fresh bundle
    if (this._hmrFileChangeListener) {
      // Clear cached bundles in case user reloads
      this._bundles = Object.create(null);
      this._hmrFileChangeListener(absPath, this._bundler.getFS.stat(absPath));
      return;
    }

    // Make sure the file watcher event runs through the system before
    // we rebuild the bundles.
    this._debouncedFileChangeHandler(absPath);
  },

  _informChangeWatchers() {
    const watchers = this._changeWatchers;
    const headers = {
      'Content-Type': 'application/json; charset=UTF-8',
    };

    watchers.forEach(w => {
      w.res.writeHead(205, headers);
      w.res.end(JSON.stringify({ changed: true }));
    });

    this._changeWatchers = [];
  },
}

module.exports = Server;
