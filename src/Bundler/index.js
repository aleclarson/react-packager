/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const { Cache } = require('node-haste');
const { version } = require('../../package.json');

const Promise = require('Promise');
const assert = require('assert');
const emptyFunction = require('emptyFunction');
const fs = require('io');
const path = require('path');
const sync = require('sync');

const Activity = require('../Activity');
const Bundle = require('./Bundle');
const BundlesLayout = require('../BundlesLayout');
const HMRBundle = require('./HMRBundle');
const ModuleTransport = require('../utils/ModuleTransport');
const PrepackBundle = require('./PrepackBundle');
const Resolver = require('../Resolver');
const Transformer = require('../JSTransformer');
const declareOpts = require('../utils/declareOpts');

const imageSize = Promise.ify(require('image-size'));

const validateOpts = declareOpts({
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
    required: false,
  },
  assetExts: {
    type: 'array',
    required: false,
  },
  assetServer: {
    type: 'object',
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
  disableInternalTransforms: {
    type: 'boolean',
    default: false,
  },
});

class Bundler {

  constructor(options) {
    const opts = this._opts = validateOpts(options);

    opts.projectRoots.forEach(verifyRootExists);

    let mtime;
    try {
      ({mtime} = fs.sync.stats(opts.transformModulePath));
      mtime = String(mtime.getTime());
    } catch (error) {
      mtime = '';
    }

    const cacheKeyParts =  [
      'react-packager-cache',
      version,
      opts.cacheVersion,
      opts.projectRoots.join(',').split(path.sep).join('-'),
      mtime,
    ];

    if (opts.transformModulePath) {
      const transformer = require(opts.transformModulePath);
      if (typeof transformer.cacheKey !== 'undefined') {
        cacheKeyParts.push(transformer.cacheKey);
      }
    }

    if (opts.getTransformOptionsModulePath) {
      this._transformOptionsModule = require(
        opts.getTransformOptionsModulePath
      );
    }

    this._cache = new Cache({
      resetCache: opts.resetCache,
      cacheKey: cacheKeyParts.join('$'),
    });

    this._resolver = new Resolver({
      cache: this._cache,
      fileWatcher: opts.fileWatcher,
      projectRoots: opts.projectRoots,
      projectExts: opts.projectExts,
      assetRoots: opts.assetRoots,
      assetExts: opts.assetExts,
      blacklist: opts.blacklist,
      redirect: opts.redirect,
      polyfillModuleNames: opts.polyfillModuleNames,
      onResolutionError: this._onResolutionError.bind(this),
    });

    this._transformer = new Transformer({
      projectRoots: opts.projectRoots,
      cache: this._cache,
      fastfs: this.getFS(),
      transformModulePath: opts.transformModulePath,
      disableInternalTransforms: opts.disableInternalTransforms,
    });
  }

  kill() {
    this._transformer.kill();
    return this._cache.end();
  }

  bundle(options) {
    const {dev, unbundle, platform} = options;
    const moduleSystemDeps =
      this._resolver.getModuleSystemDependencies({dev, unbundle, platform});
    return this._bundle({
      bundle: new Bundle(options.sourceMapUrl),
      moduleSystemDeps,
      ...options,
    });
  }

  getFS() {
    return this._resolver.getFS();
  }

  hmrBundle(options, host, port) {
    return this._bundle({
      verbose: true,
      bundle: new HMRBundle({
        sourceURLFn: this._sourceHMRURL.bind(this, options.platform, host, port),
        sourceMappingURLFn: this._sourceMappingHMRURL.bind(this, options.platform),
        findRoot: this._findRoot.bind(this),
      }),
      hot: true,
      ...options,
    });
  }

  prepackBundle({
    entryFile,
    runModule: runMainModule,
    runBeforeMainModule,
    sourceMapUrl,
    dev,
    platform,
  }) {
    const onModuleTransformed = ({module, transformed, response, bundle}) => {
      return response.getResolution(module)
      .then(resolution => {
        const deps = Object.create(null);
        return resolution.eachResolved((module, modulePath) => {
          if (module != null) {
            deps[modulePath] = module.path;
          }
        })
        .then(() => module.getName())
        .then(name => bundle.addModule(
          name,
          transformed,
          deps,
          module.isPolyfill(),
        ));
      });
    };
    const finalizeBundle = ({bundle, response}) => {
      const {mainModuleId} = response;
      bundle.finalize({runBeforeMainModule, runMainModule, mainModuleId});
      return bundle;
    };

    return this._buildBundle({
      entryFile,
      dev,
      platform,
      onModuleTransformed,
      finalizeBundle,
      bundle: new PrepackBundle(sourceMapUrl),
    });
  }

  getShallowDependencies(entryFile) {
    return this._resolver.getShallowDependencies(entryFile);
  }

  getModuleForPath(entryFile) {
    return this._resolver.getModuleForPath(entryFile);
  }

  getDependencies(options) {
    return this._resolver.getDependencies(options);
  }

  getOrderedDependencyPaths(options) {
    return this.getDependencies(options).then(
      ({ dependencies }) => {
        const ret = [];
        const promises = [];
        const placeHolder = {};
        dependencies.forEach(dep => {
          if (dep.isAsset()) {
            promises.push(
              this._opts.assetServer.getAssetData(dep.path, options.platform)
            );
            ret.push(placeHolder);
          } else {
            ret.push(dep.path);
          }
        });

        return Promise.map(promises).then(assetsData => {
          assetsData.forEach(({ files }) => {
            const index = ret.indexOf(placeHolder);
            ret.splice(index, 1, ...files);
          });
          return ret;
        });
      }
    );
  }

  _sourceHMRURL(platform, host, port, path) {
    return this._hmrURL(
      `http://${host}:${port}`,
      platform,
      'bundle',
      path,
    );
  }

  _sourceMappingHMRURL(platform, path) {
    // Chrome expects `sourceURL` when eval'ing code
    return this._hmrURL(
      '\/\/# sourceURL=',
      platform,
      'map',
      path,
    );
  }

  _hmrURL(prefix, platform, extensionOverride, path) {
    const extensionStart = path.lastIndexOf('.');

    const resource = extensionStart < 0 ? path :
      path.substring(0, extensionStart);

    const extension = extensionStart < 0 ? null :
      path.substring(extensionStart + 1);

    return (
      prefix + resource +
      '.' + extensionOverride + '?' +
      'platform=' + platform + '&runModule=false&entryModuleOnly=true&hot=true'
    );
  }

  _findRoot(filePath) {
    const fastfs = this.getFS();
    const isRoot = (root) => filePath.startsWith(root);
    let root = this._opts.projectRoots.find(isRoot);
    if (!root && fastfs._fastPaths[filePath]) {
      root = this._opts.lazyRoots.find(isRoot);
    }
    if (!root) {
      throw new Error(`'filePath' belongs to an unknown root: '${filePath}'`);
    }
    return root;
  }

  _bundle({
    bundle,
    entryFile,
    runModule: runMainModule,
    runBeforeMainModule,
    dev,
    verbose,
    platform,
    moduleSystemDeps = [],
    hot,
    entryModuleOnly,
    onResolutionError,
  }) {
    const onResolutionResponse = (response) => {
      bundle.setMainModuleId(response.mainModuleId);
      if (bundle.setNumPrependedModules) {
        bundle.setNumPrependedModules(
          response.numPrependedDependencies + moduleSystemDeps.length
        );
      }

      let dependencies;
      if (entryModuleOnly) {
        dependencies = response.dependencies
          .filter(module => module.path.endsWith(entryFile));
      } else {
        dependencies = moduleSystemDeps
          .concat(response.dependencies);
      }

      return response.copy({dependencies});
    };

    const finalizeBundle = ({bundle, transformedModules, response}) =>
      Promise.chain(transformedModules, ({module, transformed}) =>
        bundle.addModule(this._resolver, response, module, transformed)
      ).then(() => {
        bundle.finalize({runBeforeMainModule, runMainModule});
        return bundle;
      });

    return this._buildBundle({
      entryFile,
      dev,
      platform,
      verbose,
      bundle,
      hot,
      onResolutionError,
      onResolutionResponse,
      finalizeBundle,
    });
  }

  _buildBundle({
    entryFile,
    dev,
    platform,
    verbose,
    bundle,
    hot,
    onResolutionError = emptyFunction,
    onResolutionResponse = emptyFunction.thatReturnsArgument,
    onModuleTransformed = emptyFunction,
    finalizeBundle = emptyFunction,
  }) {
    const self = this;
    let threw = false;
    return self._resolver.load().then(() => {
      const findEventId = verbose && Activity.startEvent('find dependencies');
      return self.getDependencies({
        entryFile,
        dev,
        platform,
        onProgress: verbose && function() {
          if (threw) {
            return;
          }
          log('•');
          if (log.line.length >= 50) {
            log.moat(0);
          }
        },
        onError() {
          if (threw) {
            return false; // Return false to prevent 'depGraph._onResolutionError'
          }
          threw = true;
          self._onResolutionError.apply(self, arguments);
          onResolutionError.apply(null, arguments);
          return false;
        },
      })
      .then(response => {
        assert(response.mainModuleId, '\'mainModuleId\' should exist here!');
        if (verbose) {
          log.moat(1);
          Activity.endEvent(findEventId);
        }
        if (threw) {
          const error = Error('Resolution error prevented bundle from finalizing!');
          error.type = 'UnableToResolveError';
          log.moat(1);
          log.red('Error: ');
          log.white(error.message);
          log.moat(1);
          throw error;
        }
        return onResolutionResponse(response);
      });
    })
    .then(response => {
      const transformEventId = verbose && Activity.startEvent('transform');
      const transformedModules = [];
      return Promise.all(response.dependencies, (module, index) => {
        return self._transformModule({
          mainModuleName: response.mainModuleId,
          bundle,
          module,
          platform,
          dev,
          hot,
        })
        .then(transformed => {
          if (verbose) {
            log('•');
            if (log.line.length >= 50) {
              log.moat(0);
            }
          }
          onModuleTransformed({module, transformed, response, bundle});
          transformedModules[index] = {module, transformed};
        })
        .fail(error => {
          if (/Unable to find file with path/.test(error.message)) {
            response.deleteResolution(module);
          } else {
            throw error;
          }
        })
      })
      .then(() => {
        verbose && Activity.endEvent(transformEventId);
        return finalizeBundle({
          bundle,
          transformedModules,
          response,
        });
      });
    });
  }

  _onResolutionError(error, {requiredPath, fromModule}) {
    if (error.type === 'UnableToResolveError') {
      log.moat(1);
      log.red('Error: ');
      log('Could not resolve ');
      log.gray(requiredPath);
      log(' from ');
      log.gray(fromModule.path);
      log.moat(1);
    } else {
      const stack = error.stack.split(log.ln)
        .slice(error.message.split(log.ln).length);
      log.moat(1);
      log.red('InternalError: ');
      log.white(error.message);
      log.moat(0);
      log.gray.dim(stack.join(log.ln));
      log.moat(1);
    }
  }

  _processFileChange(type, filePath, root) {
    if (this._transformOptionsModule) {
      this._transformOptionsModule.onFileChange &&
        this._transformOptionsModule.onFileChange();
    }

    const absPath = path.join(root, filePath);
    this._transformer.invalidateFile(absPath);
  }

  _transformModule({
    bundle,
    module,
    mainModuleName,
    platform = null,
    dev = true,
    hot = false,
  }) {
    if (module.isNull()) {
      return Promise({
        sourceCode: module.code,
        sourcePath: module.path,
      });
    } else if (module.isAsset()) {
      return this._generateAssetModule(bundle, module, platform);
    } else if (module.isJSON()) {
      return generateJSONModule(module);
    } else {
      return this._getTransformOptions(
        {
          modulePath: module.path,
          bundleEntry: mainModuleName,
          platform,
          dev,
        },
        {hot},
      ).then(options => {
        return this._transformer.loadFileAndTransform(
          path.resolve(module.path),
          options,
        );
      });
    }
  }

  _generateAssetObjAndCode(module, platform = null) {
    // Test extension against all types supported by image-size module.
    // If it's not one of these, we won't treat it as an image.
    let isImage = [
      'png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'psd', 'svg', 'tiff'
    ].indexOf(path.extname(module.path).slice(1)) !== -1;

    return Promise.map([
      isImage ? imageSize(module.path) : null,
      this._opts.assetServer.getAssetData(module.path, platform),
    ]).then(res => {
      const dimensions = res[0];
      const assetData = res[1];
      const asset = {
        __packager_asset: true,
        fileSystemLocation: path.dirname(module.path),
        width: dimensions ? dimensions.width / module.resolution : undefined,
        height: dimensions ? dimensions.height / module.resolution : undefined,
        scales: assetData.scales,
        files: assetData.files,
        hash: assetData.hash,
        name: assetData.name,
        type: assetData.type,
      };

      const ASSET_TEMPLATE = 'module.exports = require("AssetRegistry").registerAsset(%json);';
      const code = ASSET_TEMPLATE.replace('%json', JSON.stringify(asset));

      return {asset, code};
    });
  }

  _generateAssetModule(bundle, module, platform = null) {
    return this._generateAssetObjAndCode(module, platform).then(({asset, code}) => {
      bundle.addAsset(asset);
      return new ModuleTransport({
        code: code,
        sourceCode: code,
        sourcePath: module.path,
        virtual: true,
      });
    });
  }

  _getTransformOptions(config, options) {
    const transformerOptions = this._transformOptionsModule
      ? this._transformOptionsModule.get(Object.assign(
          {
            bundler: this,
            platform: options.platform,
            dev: options.dev,
          },
          config,
        ))
      : Promise(null);

    return transformerOptions.then(overrides => {
      return {...options, ...overrides};
    });
  }

  _getPathRelativeToRoot(roots, absPath) {
    for (let i = 0; i < roots.length; i++) {
      const relPath = path.relative(roots[i], absPath);
      if (relPath[0] !== '.') {
        return relPath;
      }
    }

    throw new Error(
      'Expected root module to be relative to one of the project roots'
    );
  }
}

function generateJSONModule(module) {
  return fs.async.read(module.path).then(data => {
    const code = 'module.exports = ' + data.toString('utf8') + ';';

    return new ModuleTransport({
      code: code,
      sourceCode: code,
      sourcePath: module.path,
      virtual: true,
    });
  });
}

function verifyRootExists(root) {
  // Verify that the root exists.
  assert(fs.sync.isDir(root), 'Root has to be a valid directory');
}

module.exports = Bundler;
