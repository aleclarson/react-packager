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
const assertType = require('assertType');
const assertTypes = require('assertTypes');
const emptyFunction = require('emptyFunction');
const mergeDefaults = require('mergeDefaults');
const Promise = require('Promise');

exports.buildBundle = function(bundleId, options) {
  assertType(bundleId, String);
  assertType(options, Object);

  const bundles = this._bundles;
  if (bundles[bundleId]) {
    return bundles[bundleId];
  }

  if (!options.platform) {
    options.platform = getPlatformExtension(options.entryFile);
  }

  this._bundling = Promise(this._bundling)
    .fail(emptyFunction)
    .then(() => {
      log.moat(1);
      log.white('Bundling: ');
      log.green(bundleId);
      log.moat(1);
      options.verbose = true;
      return this._bundler.bundle(
        validateBundleOptions(options)
      ).fail(error => {
        if (error.type === 'UnableToResolveError') {
          log.moat(1);
          log.white('Deleted bundle: ');
          log.red(bundleId);
          log.moat(1);
        }

        delete bundles[bundleId];
        throw error;
      });
    });

  return bundles[bundleId] = this._bundling;
};

exports.buildBundleForHMR = function(modules, host, port) {
  return this._bundler.hmrBundle(modules, host, port);
};

exports.buildPrepackBundle = function(options) {
  if (!options.platform) {
    options.platform = getPlatformExtension(options.entryFile);
  }
  return this._bundler.prepackBundle(
    validateBundleOptions(options)
  );
};

exports.rebuildBundles = function() {
  const bundler = this._bundler;
  const bundles = this._bundles;
  return this._bundling = (
    this._bundling || Promise()
  ).then(() => {
    let bundleChain = Promise();
    Object.keys(bundles).forEach(bundleId => {
      const options = JSON.parse(bundleId);
      bundleChain = bundleChain.then(() => {
        // log.moat(1);
        // log.white('Bundling: ');
        // log.green(bundleId);
        // log.moat(1);
        return this._bundler.bundle(
          validateBundleOptions(options)
        ).then(bundle => {
          // Make a throwaway call to getSource to cache the source string.
          bundle.getSource({
            inlineSourceMap: options.inlineSourceMap,
            minify: options.minify,
            dev: options.dev,
          });
          return bundle;
        })
        .fail((error) => _reportBundleError(error, bundleId));
      });
      return bundles[bundleId] = bundleChain;
    });
    return bundleChain;
  });
};

function validateBundleOptions(options) {
  assertTypes(options, {
    sourceMapUrl: String,
    entryFile: String,
    platform: String,
    dev: Boolean.Maybe,
    verbose: Boolean.Maybe,
    minify: Boolean.Maybe,
    runModule: Boolean.Maybe,
    inlineSourceMap: Boolean.Maybe,
    runBeforeMainModule: Array.Maybe,
    unbundle: Boolean.Maybe,
    hot: Boolean.Maybe,
    entryModuleOnly: Boolean.Maybe,
    onResolutionError: Function.Maybe,
  })
  mergeDefaults(options, {
    dev: true,
    runModule: true,
    runBeforeMainModule: [
      // Ensures essential globals are available and are patched correctly.
      'InitializeJavaScriptAppEngine'
    ],
    onResolutionError: emptyFunction,
  })
  return options;
}
