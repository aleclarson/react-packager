/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const path = require('path');
const Promise = require('Promise');
const { DependencyGraph, Polyfill } = require('node-haste');

const Activity = require('../Activity');
const declareOpts = require('../utils/declareOpts');
const replacePatterns = require('../utils/replacePatterns');
const platformBlacklist = require('../utils/platformBlacklist');

const validateOpts = declareOpts({
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
  assetExts: {
    type: 'array',
    required: true,
  },
  blacklist: {
    type: 'function',
    required: false,
  },
  redirect: {
    type: 'object',
    required: false,
  },
  polyfillModuleNames: {
    type: 'array',
    default: [],
  },
  moduleFormat: {
    type: 'string',
    default: 'haste',
  },
  fileWatcher: {
    type: 'object',
    required: true,
  },
  cache: {
    type: 'object',
    required: true,
  },
});

const getDependenciesValidateOpts = declareOpts({
  entryFile: {
    type: 'string',
    required: true,
  },
  dev: {
    type: 'boolean',
    default: true,
  },
  platform: {
    type: 'string',
    required: false,
  },
  unbundle: {
    type: 'boolean',
    default: false,
  },
  recursive: {
    type: 'boolean',
    default: true,
  },
  verbose: {
    type: 'boolean',
    required: false,
  },
});

class Resolver {

  constructor(options) {
    const opts = validateOpts(options);

    this._depGraph = new DependencyGraph({
      lazyRoots: [lotus.path],
      projectRoots: opts.projectRoots,
      projectExts: opts.projectExts,
      assetExts: opts.assetExts,
      fileWatcher: opts.fileWatcher,
      activity: Activity,
      platforms: ['ios', 'android'],
      preferNativePlatform: true,
      cache: opts.cache,
      shouldThrowOnUnresolvedErrors: (_, platform) => platform === 'ios',
      blacklist: opts.blacklist,
      redirect: opts.redirect,
    });

    this._polyfillModuleNames = opts.polyfillModuleNames || [];
  }

  load() {
    return this._depGraph.load();
  }

  getShallowDependencies(entryFile) {
    return this._depGraph.getShallowDependencies(entryFile);
  }

  stat(filePath) {
    return this._depGraph.getFS().stat(filePath);
  }

  getModuleForPath(entryFile) {
    return this._depGraph.getModuleForPath(entryFile);
  }

  getDependencies(options) {
    const opts = getDependenciesValidateOpts(options);
    opts.blacklist = platformBlacklist(opts.platform);
    return this._depGraph.getDependencies(opts)
      .then(resolutionResponse => {
        this._getPolyfillDependencies().reverse().forEach(
          polyfill => resolutionResponse.prependDependency(polyfill)
        );

        return resolutionResponse.finalize();
      });
  }

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
  }

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
  }

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
      const resolvedDepsArr = [];

      const pairs = resolutionResponse.getResolvedDependencyPairs(module);
      return Promise.map(pairs, ([depName, depModule]) => {
        if (depModule) {
          return depModule.getName().then(name => {
            resolvedDeps[depName] = name;
            resolvedDepsArr.push(name);
          });
        }
      }).then(() => {
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
  }

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
  }

  getDebugInfo() {
    return this._depGraph.getDebugInfo();
  }

  getFS() {
    return this._depGraph.getFS();
  }
}

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

module.exports = Resolver;
