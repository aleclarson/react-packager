/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const {
  Cache,
  DependencyGraph,
  FileWatcher,
  Polyfill,
} = require('node-haste');

const Promise = require('Promise');
const PureObject = require('PureObject');
const Type = require('Type');
const assertTypes = require('assertTypes');
const mergeDefaults = require('mergeDefaults');
const path = require('path');

const Activity = require('../Activity');
const replacePatterns = require('../utils/replacePatterns');

const type = Type('Resolver')

type.defineOptions({
  cache: Cache.isRequired,
  fileWatcher: FileWatcher.isRequired,
  projectRoots: Array,
  projectExts: Array,
  assetRoots: Array,
  assetExts: Array,
  lazyRoots: Array,
  platforms: Array,
  blacklist: Function,
  redirect: PureObject,
  polyfillModuleNames: Array,
  extraNodeModules: Object,
  onResolutionError: Function,
})

type.defineValues({

  _polyfillModuleNames(opts) {
    return opts.polyfillModuleNames || [];
  },

  _graph(opts) {
    return DependencyGraph({
      cache: opts.cache,
      fileWatcher: opts.fileWatcher,
      projectRoots: opts.projectRoots,
      projectExts: opts.projectExts,
      assetRoots: opts.assetRoots,
      assetExts: opts.assetExts,
      lazyRoots: opts.lazyRoots || [lotus.path],
      platforms: opts.platforms || ['ios', 'android', 'web'],
      preferNativePlatform: true,
      blacklist: opts.blacklist,
      redirect: opts.redirect,
      activity: Activity,
      extraNodeModules: opts.extraNodeModules,
      onResolutionError: opts.onResolutionError,
    });
  },
})

type.defineMethods({

  load() {
    return this._graph.load();
  },

  getFS() {
    return this._graph.getFS();
  },

  getShallowDependencies(entryFile) {
    return this._graph.getShallowDependencies(entryFile);
  },

  getModuleForPath(entryFile) {
    return this._graph.getModuleForPath(entryFile);
  },

  getDependencies(options) {
    assertTypes(options, {
      entryFile: String,
      dev: Boolean.Maybe,
      unbundle: Boolean.Maybe,
      recursive: Boolean.Maybe,
      platform: String.Maybe,
      onProgress: Function.Maybe,
      onError: Function.Maybe,
    });
    mergeDefaults(options, {
      dev: true,
      unbundle: false,
    });

    return this._graph.getDependencies(options)
      .then(response => {
        let dependencies = response.dependencies.slice();
        let numPrependedDependencies = response.numPrependedDependencies;
        this._getPolyfillDependencies()
          .reverse()
          .forEach(polyfill => {
            dependencies.unshift(polyfill);
            numPrependedDependencies += 1;
          });
        return response.copy({
          dependencies,
          numPrependedDependencies,
        });
      });
  },

  getModuleSystemDependencies(options) {

    const prelude = options.dev
        ? path.join(__dirname, 'polyfills/prelude_dev.js')
        : path.join(__dirname, 'polyfills/prelude.js');

    const moduleSystem = options.unbundle
        ? path.join(__dirname, 'polyfills/require-unbundle.js')
        : path.join(__dirname, 'polyfills/require.js');

    return [
      prelude,
      moduleSystem
    ].map(moduleName => new Polyfill({
      file: moduleName,
      id: moduleName,
      dependencies: [],
    }));
  },

  resolveRequires(resolutionResponse, module, code) {
    return Promise.try(() => {
      if (module.isPolyfill()) {
        return { code };
      }

      if (module.isNull()) {
        return {
          name: module.path,
          code: module.code,
        };
      }

      const resolvedDeps = Object.create(null);
      const resolution = resolutionResponse.getResolution(module);
      return resolution.filterResolved((dependency, depName) => {
        return dependency && dependency.getName().then(depId => {
          resolvedDeps[depName] = depId;
        }).fail(error => {
          if (/Unable to find file with path/.test(error.message)) {
            resolution.markDirty(dependency.path);
            resolutionResponse.deleteResolution(dependency);
          } else {
            throw error;
          }
        })
      })
      .then(() => {
        const relativizeCode = (codeMatch, pre, quot, depName, post) => {
          const depId = resolvedDeps[depName];
          if (depId) {
            return pre + quot + depId + post;
          } else {
            return codeMatch;
          }
        };

        code = code
          .replace(replacePatterns.IMPORT_RE, relativizeCode)
          .replace(replacePatterns.EXPORT_RE, relativizeCode)
          .replace(replacePatterns.REQUIRE_RE, relativizeCode);

        return module.getName().then(name => {
          return {name, code};
        });
      });
    });
  },

  wrapModule(resolutionResponse, module, code) {
    if (module.isPolyfill()) {
      return Promise({
        code: definePolyfillCode(code),
      });
    }

    return this.resolveRequires(resolutionResponse, module, code)
      .then(({name, code}) => {
        return {name, code: defineModuleCode(name, code)};
      });
  },

  _getPolyfillDependencies() {
    const polyfillModuleNames = [
      path.join(__dirname, 'polyfills/polyfills.js'),
      path.join(__dirname, 'polyfills/error-guard.js'),
      path.join(__dirname, 'polyfills/String.prototype.es6.js'),
      path.join(__dirname, 'polyfills/Array.prototype.es6.js'),
      path.join(__dirname, 'polyfills/Array.es6.js'),
      path.join(__dirname, 'polyfills/Object.es7.js'),
      path.join(__dirname, 'polyfills/babelHelpers.js'),
    ].concat(this._polyfillModuleNames);

    return polyfillModuleNames.map(
      (polyfillModuleName, idx) => new Polyfill({
        file: polyfillModuleName,
        id: polyfillModuleName,
        dependencies: polyfillModuleNames.slice(0, idx),
      })
    );
  },
})

module.exports = type.build()

//
// Helpers
//

const moduleArgNames = ['global', 'require', 'module', 'exports'].join (', ');

function defineModuleCode(moduleName, code) {

  // Indent each line in the code block.
  code = code
    .split(log.ln)
    .map(code => '  ' + code)
    .join(log.ln);

  return [
    `__d(`,
    quoteWrap(moduleName),
    `, function(${moduleArgNames}) {`,
    log.ln,
    code,
    log.ln,
    `});`,
  ].join('');
}

function definePolyfillCode(code) {
  return [
    '(function(global) {',
    code,
    `\n})(typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : this);`,
  ].join('');
}

function quoteWrap(string) {
  return '\'' + string + '\'';
}
