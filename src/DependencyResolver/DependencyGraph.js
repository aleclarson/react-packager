 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const emptyFunction = require('emptyFunction');
const syncFs = require('io/sync');
const sync = require('sync');
const path = require('path');
const util = require('util');

const crawl = require('./crawlers');
const Fastfs = require('./fastfs');
const HasteMap = require('./HasteMap');
const ModuleCache = require('./ModuleCache');
const ResolutionRequest = require('./ResolutionRequest');
const ResolutionResponse = require('./ResolutionResponse');
const getPlatformExtension = require('../utils/getPlatformExtension');
const makePlatformBlacklist = require('../utils/platformBlacklist');

const ERROR_BUILDING_DEP_GRAPH = 'DependencyGraphError';

const defaultActivity = {
  startEvent: () => {},
  endEvent: () => {},
};

class DependencyGraph {
  constructor({
    internalRoots,
    projectRoots,
    projectExts,
    assetServer,
    activity = defaultActivity,
    getBlacklist = emptyFunction,
    fileWatcher,
    providesModuleNodeModules,
    platforms = [],
    preferNativePlatform = false,
    cache,
    mocksPattern,
    extractRequires,
    transformCode,
    shouldThrowOnUnresolvedErrors = emptyFunction.thatReturnsTrue,
  }) {
    this._opts = {
      internalRoots,
      projectRoots,
      projectExts,
      assetServer,
      activity,
      fileWatcher,
      providesModuleNodeModules,
      platforms,
      preferNativePlatform,
      cache,
      mocksPattern,
      extractRequires,
      transformCode,
      shouldThrowOnUnresolvedErrors,
      ignoreFilePath: getBlacklist() || emptyFunction.thatReturnsFalse,
    };
  }

  load() {
    if (this._loading) {
      return this._loading;
    }

    const { ignoreFilePath, fileWatcher, activity } = this._opts;

    const crawlActivity = activity.startEvent('crawl filesystem');

    const roots = this._mergeArrays([
      this._opts.internalRoots,
      this._opts.projectRoots,
    ]);

    const exts = this._mergeArrays([
      this._opts.projectExts,
      this._opts.assetServer._assetExts,
    ]);

    this._crawling = crawl(roots, {
      exts,
      ignoreFilePath,
      fileWatcher,
    });

    this._crawling.then(() =>
      activity.endEvent(crawlActivity));

    this._fastfs = new Fastfs(
      'find .js files',
      roots,
      fileWatcher,
      {
        activity,
        ignoreFilePath,
        crawling: this._crawling,
      }
    );

    this._fastfs._detachedRoots.push(lotus.file);

    this._fastfs.on('change', this._processFileChange.bind(this));

    this._moduleCache = new ModuleCache({
      fastfs: this._fastfs,
      cache: this._opts.cache,
      extractRequires: this._opts.extractRequires,
      transformCode: this._opts.transformCode,
    });

    this._hasteMap = new HasteMap({
      fastfs: this._fastfs,
      extensions: this._opts.projectExts,
      moduleCache: this._moduleCache,
      preferNativePlatform: this._opts.preferNativePlatform,
      ignoreFilePath,
    });

    return this._loading = this._fastfs.build()

    .then(() => {
      const hasteActivity = activity.startEvent('find haste modules');
      return this._hasteMap.build().then(() => {
        const hasteModules = this._hasteMap._map;
        const hasteModuleNames = Object.keys(hasteModules);

        const json = {};
        hasteModuleNames.forEach(moduleName => {
          const map = hasteModules[moduleName];
          const mod = map.generic || Object.keys(map)[0];
          if (mod && mod.path) {
            json[moduleName] = path.relative(lotus.path, mod.path);
          }
        });

        syncFs.write(
          lotus.path + '/.ReactNativeHasteMap.json',
          JSON.stringify(json, null, 2)
        );

        log.moat(1);
        log.white('Haste modules: ');
        log.cyan(hasteModuleNames.length);
        log.moat(1);
        activity.endEvent(hasteActivity);
      });
    })

    .then(() => {
      const assetActivity = activity.startEvent('find assets');
      this._opts.assetServer._build(this._fastfs);
      activity.endEvent(assetActivity);
    });
  }

  /**
   * Returns a promise with the direct dependencies the module associated to
   * the given entryPath has.
   */
  getShallowDependencies(entryPath) {
    return this._moduleCache.getModule(entryPath).getDependencies();
  }

  getFS() {
    return this._fastfs;
  }

  /**
   * Returns the module object for the given path.
   */
  getModuleForPath(entryFile) {
    return this._moduleCache.getModule(entryFile);
  }

  getAllModules() {
    return this.load().then(() => this._moduleCache.getAllModules());
  }

  getDependencies(entryPath, platform, recursive = true) {
    return this.load().then(() => {
      platform = this._getRequestPlatform(entryPath, platform);
      const absPath = this._getAbsolutePath(entryPath);

      const platformBlacklist = makePlatformBlacklist(platform);
      const ignoreFilePath = (filePath) =>
        platformBlacklist.test(filePath) ||
          this._opts.ignoreFilePath(filePath);

      const req = new ResolutionRequest({
        platform,
        ignoreFilePath,
        preferNativePlatform: this._opts.preferNativePlatform,
        projectExts: this._opts.projectExts,
        entryPath: absPath,
        fastfs: this._fastfs,
        hasteMap: this._hasteMap,
        moduleCache: this._moduleCache,
        assetServer: this._opts.assetServer,
        shouldThrowOnUnresolvedErrors: this._opts.shouldThrowOnUnresolvedErrors,
      });

      const response = new ResolutionResponse();

      return Promise.all([
        req.getOrderedDependencies(
          response,
          this._opts.mocksPattern,
          recursive,
        ),
        req.getAsyncDependencies(response),
      ])

      .then(() => response);
    });
  }

  getDebugInfo() {
    var string = '';
    sync.each(this._moduleCache._moduleCache, (mod, absPath) => {
      string += '<h3>' + mod.path + '</h3><br/><br/>&nbsp;&nbsp;<h4>Dependencies:</h4><br/>';
      sync.each(mod._dependencies, (mod) => {
        string += '&nbsp;&nbsp;&nbsp;&nbsp;' + mod.path + '<br/>';
      });
      string += '<br/><br/>&nbsp;&nbsp;<h4>Dependers:</h4><br/>';
      sync.each(mod._dependers, (mod) => {
        string += '&nbsp;&nbsp;&nbsp;&nbsp;' + mod.path + '<br/>';
      });
      string += '<br/><br/>';
    });
    return string;
  }

  matchFilesByPattern(pattern) {
    return this.load().then(() => this._fastfs.matchFilesByPattern(pattern));
  }

  _getRequestPlatform(entryPath, platform) {
    if (platform == null) {
      platform = getPlatformExtension(entryPath);
      if (platform == null || this._opts.platforms.indexOf(platform) === -1) {
        platform = null;
      }
    } else if (this._opts.platforms.indexOf(platform) === -1) {
      throw new Error('Unrecognized platform: ' + platform);
    }
    return platform;
  }

  _getAbsolutePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }

    for (let i = 0; i < this._opts.projectRoots.length; i++) {
      const root = this._opts.projectRoots[i];
      const potentialAbsPath = path.join(root, filePath);
      if (this._fastfs.fileExists(potentialAbsPath)) {
        return path.resolve(potentialAbsPath);
      }
    }

    throw new NotFoundError(
      'Cannot find entry file %s in any of the roots: %j',
      filePath,
      this._opts.projectRoots
    );
  }

  _processFileChange(type, filePath, root, fstat) {
    const absPath = path.join(root, filePath);
    if (!this._opts.ignoreFilePath(absPath)) {
      return;
    }

    // Ok, this is some tricky promise code. Our requirements are:
    // * we need to report back failures
    // * failures shouldn't block recovery
    // * Errors can leave `hasteMap` in an incorrect state, and we need to rebuild
    // After we process a file change we record any errors which will also be
    // reported via the next request. On the next file change, we'll see that
    // we are in an error state and we should decide to do a full rebuild.
    this._loading = this._loading.always(() => {
      if (this._hasteMapError) {
        console.warn(
          'Rebuilding haste map to recover from error:\n' +
          this._hasteMapError.stack
        );
        this._hasteMapError = null;

        // Rebuild the entire map if last change resulted in an error.
        this._loading = this._hasteMap.build();
      } else {
        this._loading = this._hasteMap.processFileChange(type, absPath);
        this._loading.fail((e) => this._hasteMapError = e);
      }
      return this._loading;
    });
  }

  _mergeArrays(arrays) {
    const result = [];
    arrays.forEach((array) => {
      if (!Array.isArray(array)) {
        return;
      }
      array.forEach((item) =>
        result.push(item));
    });
    return result;
  }
}

function NotFoundError() {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);
  var msg = util.format.apply(util, arguments);
  this.message = msg;
  this.type = this.name = 'NotFoundError';
  this.status = 404;
}
util.inherits(NotFoundError, Error);

module.exports = DependencyGraph;
