/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const declareOpts = require('../../utils/declareOpts');
const getPlatformExtension = require('../../utils/getPlatformExtension');
const Promise = require('Promise');

const validateBundleOptions = declareOpts({
  sourceMapUrl: {
    type: 'string',
    required: false,
  },
  entryFile: {
    type: 'string',
    required: true,
  },
  dev: {
    type: 'boolean',
    default: true,
  },
  verbose: {
    type: 'boolean',
    default: false,
  },
  minify: {
    type: 'boolean',
    default: false,
  },
  runModule: {
    type: 'boolean',
    default: true,
  },
  inlineSourceMap: {
    type: 'boolean',
    default: false,
  },
  platform: {
    type: 'string',
    required: true,
  },
  runBeforeMainModule: {
    type: 'array',
    default: [
      // Ensures essential globals are available and are patched correctly.
      'InitializeJavaScriptAppEngine'
    ],
  },
  unbundle: {
    type: 'boolean',
    default: false,
  },
  hot: {
    type: 'boolean',
    default: false,
  },
  entryModuleOnly: {
    type: 'boolean',
    default: false,
  },
});

exports.buildBundle = function(hash, options) {

  if (hash && this._bundles[hash]) {
    return this._bundles[hash];
  }

  if (!options.platform) {
    options.platform = getPlatformExtension(options.entryFile);
  }

  options.verbose = true;

  this._bundling = (this._bundling || Promise())
    .then(() => _buildBundle(this._bundler, hash, options));

  if (hash) {
    this._bundles[hash] = this._bundling;
  }

  return this._bundling;
};

exports.buildBundleForHMR = function(modules, host, port) {
  return this._bundler.hmrBundle(modules, host, port);
};

exports.buildPrepackBundle = function(options) {
  if (!options.platform) {
    options.platform = getPlatformExtension(options.entryFile);
  }

  const bundleOptions = validateBundleOptions(options);
  return this._bundler.prepackBundle(bundleOptions);
};

exports.rebuildBundles = function() {
  const bundler = this._bundler;
  const bundles = this._bundles;
  return this._bundling = (
    this._bundling || Promise()
  ).then(() => {
    let bundleChain = Promise();
    Object.keys(bundles).forEach(hash => {
      const options = JSON.parse(hash);
      bundleChain = bundleChain.then(() => {
        return _buildBundle(
          bundler,
          hash,
          options,
        ).then(bundle => {
          // Make a throwaway call to getSource to cache the source string.
          bundle.getSource({
            inlineSourceMap: options.inlineSourceMap,
            minify: options.minify,
            dev: options.dev,
          });
          return bundle;
        }, (error) => {
          log.moat(1);
          log.red('Error: ');
          log.white(hash);
          log.gray.dim(error.stack);
          log.moat(1);
        });
      });
      return bundles[hash] = bundleChain;
    });
    return bundleChain;
  });
};

function _buildBundle(bundler, hash, options) {
  if (hash) {
    log.moat(1);
    log.white('Bundling: ');
    log.green(hash);
    log.moat(1);
  }
  return bundler.bundle(
    validateBundleOptions(options)
  ).fail(error => {
    log.moat(1);
    log.red('Error: ');
    log.white(hash);
    log.gray.dim(error.stack);
    log.moat(1);
  });
}
