/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const syncFs = require('io/sync');
const emptyFunction = require('emptyFunction');

const Cache = require('../DependencyResolver/Cache');
const Bundle = require('./Bundle');
const version = require('../../package.json').version;
const Activity = require('../Activity');
const Resolver = require('../Resolver');
const HMRBundle = require('./HMRBundle');
const Transformer = require('../JSTransformer');
const declareOpts = require('../utils/declareOpts');
const BundlesLayout = require('../BundlesLayout');
const PrepackBundle = require('./PrepackBundle');
const ModuleTransport = require('../utils/ModuleTransport');

const imageSize = Promise.ify(require('image-size'));
const readFile = Promise.ify(fs.readFile);

const validateOpts = declareOpts({
  internalRoots: {
    type: 'array',
    required: true,
  },
  projectRoots: {
    type: 'array',
    required: true,
  },
  projectExts: {
    type: 'array',
    required: true,
  },
  assetServer: {
    type: 'object',
    required: true,
  },
  getBlacklist: {
    type: 'function',
    default: emptyFunction,
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
  nonPersistent: {
    type: 'boolean',
    default: false,
  },
  fileWatcher: {
    type: 'object',
    required: true,
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
      ({mtime} = fs.statSync(opts.transformModulePath));
      mtime = String(mtime.getTime());
    } catch (error) {
      mtime = '';
    }

    this._cache = new Cache({
      resetCache: opts.resetCache,
      cacheKey: [
        'react-packager-cache',
        version,
        opts.cacheVersion,
        opts.projectRoots.join(',').split(path.sep).join('-'),
        mtime
      ].join('$'),
    });

    this._resolver = new Resolver({
      internalRoots: opts.internalRoots,
      projectRoots: opts.projectRoots,
      projectExts: opts.projectExts,
      assetServer: opts.assetServer,
      getBlacklist: opts.getBlacklist,
      polyfillModuleNames: opts.polyfillModuleNames,
      moduleFormat: opts.moduleFormat,
      fileWatcher: opts.fileWatcher,
      cache: this._cache,
    });

    this._bundlesLayout = new BundlesLayout({
      dependencyResolver: this._resolver,
      resetCache: opts.resetCache,
      cacheVersion: opts.cacheVersion,
      projectRoots: opts.projectRoots,
    });

    this._transformer = new Transformer({
      projectRoots: opts.projectRoots,
      cache: this._cache,
      fastfs: this._resolver._depGraph._fastfs,
      transformModulePath: opts.transformModulePath,
      disableInternalTransforms: opts.disableInternalTransforms,
    });

    this._projectRoots = opts.projectRoots;
    this._assetServer = opts.assetServer;

    if (opts.getTransformOptionsModulePath) {
      this._transformOptionsModule = require(
        opts.getTransformOptionsModulePath
      );
    }
  }

  kill() {
    this._transformer.kill();
    return this._cache.end();
  }

  getLayout(main, isDev) {
    return this._bundlesLayout.generateLayout(main, isDev);
  }

  bundle(options) {
    return this._bundle({
      bundle: new Bundle(options.sourceMapUrl),
      includeSystemDependencies: true,
      ...options,
    });
  }

  _sourceHMRURL(platform, path) {
    return this._hmrURL(
      'http://localhost:8081', // TODO: (martinb) avoid hardcoding
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
    const matchingRoot = this._projectRoots.find(root => path.startsWith(root));

    if (!matchingRoot) {
      throw new Error('No matching project root for ', path);
    }

    const extensionStart = path.lastIndexOf('.');
    let resource = path.substring(
      matchingRoot.length,
      extensionStart !== -1 ? extensionStart : undefined,
    );

    const extension = extensionStart !== -1
      ? path.substring(extensionStart + 1)
      : null;

    return (
      prefix + resource +
      '.' + extensionOverride + '?' +
      'platform=' + platform + '&runModule=false&entryModuleOnly=true&hot=true'
    );
  }

  bundleForHMR(options) {
    return this._bundle({
      bundle: new HMRBundle({
        sourceURLFn: this._sourceHMRURL.bind(this, options.platform),
        sourceMappingURLFn: this._sourceMappingHMRURL.bind(
          this,
          options.platform,
        ),
      }),
      hot: true,
      ...options,
    });
  }

  _bundle({
    bundle,
    modules,
    entryFile,
    runModule: runMainModule,
    runBeforeMainModule,
    dev: isDev,
    includeSystemDependencies,
    platform,
    unbundle: isUnbundle,
    hot: hot,
    entryModuleOnly,
    resolutionResponse,
  }) {
    let transformEventId;
    const moduleSystemDeps = includeSystemDependencies
      ? this._resolver.getModuleSystemDependencies(
        { dev: isDev, platform, isUnbundle }
      )
      : [];

    const findModules = () => {
      const findEventId = Activity.startEvent('find dependencies');
      return this.getDependencies(entryFile, isDev, platform).then(response => {
        Activity.endEvent(findEventId);
        bundle.setMainModuleId(response.mainModuleId);
        bundle.setMainModuleName(response.mainModuleId);
        if (!entryModuleOnly && bundle.setNumPrependedModules) {
          bundle.setNumPrependedModules(
            response.numPrependedDependencies + moduleSystemDeps.length
          );
        }

        return {
          response,
          modulesToProcess: response.dependencies,
        };
      });
    };

    const useProvidedModules = () => {
      const moduleId = this._resolver.getModuleForPath(entryFile);
      bundle.setMainModuleId(moduleId);
      bundle.setMainModuleName(moduleId);
      return Promise({
        response: resolutionResponse,
        modulesToProcess: modules
      });
    };

    return (
      modules ? useProvidedModules() : findModules()
    ).then(({response, modulesToProcess}) => {

      transformEventId = Activity.startEvent('transform');

      let dependencies;
      if (entryModuleOnly) {
        dependencies = response.dependencies.filter(module =>
          module.path.endsWith(entryFile)
        );
      } else {
        const moduleSystemDeps = includeSystemDependencies
          ? this._resolver.getModuleSystemDependencies(
            { dev: isDev, platform, isUnbundle }
          )
          : [];

        const modulesToProcess = modules || response.dependencies;
        dependencies = moduleSystemDeps.concat(modulesToProcess);
      }

      log.moat(1);
      return Promise.map(dependencies, (module) => {
        return this._transformModule(
          bundle,
          module,
          platform,
          isDev,
          hot,
        ).then(transformed => {
          log.cyan.dim('•');
          if (log.line.length >= 50) {
            log.moat(0);
          }
          return {
            module,
            transformed,
          };
        });
      }).then(transformedModules => {
        log.moat(1);
        return Promise.map(transformedModules, ({ module, transformed }) =>
          bundle.addModule(
            this._resolver,
            response,
            module,
            transformed,
          )
        );
      });
    }).then(() => {
      Activity.endEvent(transformEventId);
      bundle.finalize({runBeforeMainModule, runMainModule});
      return bundle;
    });
  }

  prepackBundle({
    entryFile,
    runModule: runMainModule,
    runBeforeMainModule,
    sourceMapUrl,
    dev: isDev,
    platform,
  }) {
    const bundle = new PrepackBundle(sourceMapUrl);
    const findEventId = Activity.startEvent('find dependencies');
    let transformEventId;
    let mainModuleId;

    return this.getDependencies(entryFile, isDev, platform).then(response => {

      mainModuleId = response.mainModuleId;

      return Promise.map(response.dependencies, (module) => {
        return module.getName().then(name => {
          return {
            name,
            path: path.relative(
              lotus.path,
              module.path,
            ),
          }
        })
      })

      .then(namedModules => {
        log.moat(1);
        log.white('Total dependencies: ');
        log.yellow(response.dependencies.length);
        log.moat(1);

        syncFs.write(
          lotus.path + '/.ReactNativeModules.json',
          JSON.stringify(namedModules, null, 2)
        );

        Activity.endEvent(findEventId);
        transformEventId = Activity.startEvent('transform');
      })

      .then(() => {
        return Promise.map(response.dependencies, (module) => {
          return this._transformModule(
            bundle,
            module,
            platform,
            isDev,
          ).then(transformed => {
            if (bar) {
              bar.tick();
            }

            const deps = Object.create(null);
            const pairs = response.getResolvedDependencyPairs(module);
            if (pairs) {
              pairs.forEach(pair => {
                deps[pair[0]] = pair[1].path;
              });
            }

            return module.getName().then(name => {
              bundle.addModule(name, transformed, deps, module.isPolyfill());
            });
          });
        });
      })
    })

    .then(() => {
      Activity.endEvent(transformEventId);
      bundle.finalize({runBeforeMainModule, runMainModule, mainModuleId });
      return bundle;
    });
  }

  invalidateFile(filePath) {
    if (this._transformOptionsModule) {
      this._transformOptionsModule.onFileChange &&
        this._transformOptionsModule.onFileChange();
    }

    this._transformer.invalidateFile(filePath);
  }

  getShallowDependencies(entryFile) {
    return this._resolver.getShallowDependencies(entryFile);
  }

  stat(filePath) {
    return this._resolver.stat(filePath);
  }

  getModuleForPath(entryFile) {
    return this._resolver.getModuleForPath(entryFile);
  }

  getDependencies(main, isDev, platform, recursive = true) {
    return this._resolver.getDependencies(
      main,
      {
        dev: isDev,
        platform,
        recursive,
      },
    );
  }

  getOrderedDependencyPaths({ entryFile, dev, platform }) {
    return this.getDependencies(entryFile, dev, platform).then(
      ({ dependencies }) => {

        const ret = [];
        const promises = [];
        const placeHolder = {};
        dependencies.forEach(dep => {
          if (dep.isAsset()) {
            const relPath = getPathRelativeToRoot(
              this._projectRoots,
              dep.path
            );
            promises.push(
              this._assetServer.getAssetData(relPath, platform)
            );
            ret.push(placeHolder);
          } else {
            ret.push(dep.path);
          }
        });

        return Promise.all(promises).then(assetsData => {
          assetsData.forEach(({ files }) => {
            const index = ret.indexOf(placeHolder);
            ret.splice(index, 1, ...files);
          });
          return ret;
        });
      }
    );
  }

  getGraphDebugInfo() {
    return this._resolver.getDebugInfo();
  }

  _transformModule(bundle, module, platform = null, dev = true, hot = false) {

    // TODO Strip null references entirely?
    //      ie: Replace `require()` with `null`
    if (module.isNull()) {
      return Promise({
        sourceCode: module.code,
        sourcePath: module.path,
      });
    }

    if (module.isAsset()) {
      return this._generateAssetModule(bundle, module, platform);
    }

    if (module.isJSON()) {
      return generateJSONModule(module);
    }

    return this._getTransformOptions(
      {
        bundleEntry: bundle.getMainModuleName(),
        platform: platform,
        dev: dev,
        modulePath: module.path,
      },
      {hot: hot},
    ).then(options => {
      return this._transformer.loadFileAndTransform(
        path.resolve(module.path),
        options,
      );
    });
  }

  _transformModuleForHMR(module, platform) {
    if (module.isAsset()) {
      return this._generateAssetObjAndCode(module, platform).then(
        ({asset, code}) => {
          return {
            code,
          };
        }
      );
    } else {
      // TODO(martinb): pass non null main (t9527509)
      return this._getTransformOptions(
        {main: null, dev: true, platform: 'ios'}, // TODO(martinb): avoid hard-coding platform
        {hot: true},
      ).then(options => {
        return this._transformer.loadFileAndTransform(module.path, options);
      });
    }
  }

  _generateAssetObjAndCode(module, platform = null) {
    const relPath = getPathRelativeToRoot(this._projectRoots, module.path);
    let assetUrlPath = path.join('/assets', path.dirname(relPath));

    // On Windows, change backslashes to slashes to get proper URL path from file path.
    if (path.sep === '\\') {
      assetUrlPath = assetUrlPath.replace(/\\/g, '/');
    }

    // Test extension against all types supported by image-size module.
    // If it's not one of these, we won't treat it as an image.
    let isImage = [
      'png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'psd', 'svg', 'tiff'
    ].indexOf(path.extname(module.path).slice(1)) !== -1;

    return Promise.all([
      isImage ? imageSize(module.path) : null,
      this._assetServer.getAssetData(relPath, platform),
    ]).then(res => {
      const dimensions = res[0];
      const assetData = res[1];
      const asset = {
        __packager_asset: true,
        fileSystemLocation: path.dirname(module.path),
        httpServerLocation: assetUrlPath,
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
}

function generateJSONModule(module) {
  return readFile(module.path).then(data => {
    const code = 'module.exports = ' + data.toString('utf8') + ';';

    return new ModuleTransport({
      code: code,
      sourceCode: code,
      sourcePath: module.path,
      virtual: true,
    });
  });
}

function getPathRelativeToRoot(roots, absPath) {
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

function verifyRootExists(root) {
  // Verify that the root exists.
  assert(fs.statSync(root).isDirectory(), 'Root has to be a valid directory');
}

class DummyCache {
  get(filepath, field, loaderCb) {
    return loaderCb();
  }

  end(){}
  invalidate(filepath){}
}
module.exports = Bundler;
