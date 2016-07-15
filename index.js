/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

require('./env');

var fs = require('io');
var path = require('path');
var debug = require('debug');
var omit = require('underscore').omit;
var Activity = require('./js/Activity');
var FileWatcher = require('node-haste').FileWatcher;

exports.loadConfig = require('./js/utils/loadConfig');

exports.createServer = createServer;

exports.createFileWatcher = createFileWatcher;

exports.middleware = function(options) {
  return createServer(options).middleware();
};

exports.buildBundle = function(options, bundleOptions) {
  var server = createNonPersistentServer(options);
  return server.buildBundle(bundleOptions)
    .then(function(p) {
      server.end();
      return p;
    });
};

exports.buildPrepackBundle = function(options, bundleOptions) {
  var server = createNonPersistentServer(options);
  return server.buildPrepackBundle(bundleOptions)
    .then(function(p) {
      server.end();
      return p;
    });
};

exports.buildBundleFromUrl = function(options, reqUrl) {
  var server = createNonPersistentServer(options);
  return server.buildBundleFromUrl(reqUrl)
    .then(function(p) {
      server.end();
      return p;
    });
};

exports.getDependencies = function(options, bundleOptions) {
  var server = createNonPersistentServer(options);
  return server.getDependencies(bundleOptions)
    .then(function(r) {
      server.end();
      return r.dependencies;
    });
};

exports.createClientFor = function(options) {
  if (options.verbose) {
    enableDebug();
  }
  startSocketInterface();
  return (
    require('./js/SocketInterface')
      .getOrCreateSocketFor(omit(options, ['verbose']))
  );
};

exports.Activity = Activity;

function enableDebug() {
  // react-packager logs debug messages using the 'debug' npm package, and uses
  // the following prefix throughout.
  // To enable debugging, we need to set our pattern or append it to any
  // existing pre-configured pattern to avoid disabling logging for
  // other packages
  var debugPattern = 'ReactNativePackager:*';
  var existingPattern = debug.load();
  if (existingPattern) {
    debugPattern += ',' + existingPattern;
  }
  debug.enable(debugPattern);
}

function createServer(options) {
  // the debug module is configured globally, we need to enable debugging
  // *before* requiring any packages that use `debug` for logging
  if (options.verbose) {
    enableDebug();
  }

  startSocketInterface();
  var Server = require('./js/Server');
  return new Server(omit(options, ['verbose']));
}

function createNonPersistentServer(options) {
  Activity.disable();
  // Don't start the filewatcher or the cache.
  if (options.nonPersistent == null) {
    options.nonPersistent = true; // TODO: 'options.nonPersistent' is deprecated!
  }

  return createServer(options);
}

// we need to listen on a socket as soon as a server is created, but only once.
// This file also serves as entry point when spawning a socket server; in that
// case we need to start the server immediately.
var didStartSocketInterface = false;
function startSocketInterface() {
  if (didStartSocketInterface) {
    return;
  }
  didStartSocketInterface = true;
  require('./js/SocketInterface').listenOnServerMessages();
}

if (require.main === module) { // used as entry point
  startSocketInterface();
}

// Options:
//   - roots: Array (required)
//   - extensions: Array (required)
//   - nonPersistent: Boolean (default=false)
function createFileWatcher(options) {
  if (options.nonPersistent) {
    return FileWatcher.createDummyWatcher();
  }

  const globs = options.extensions.map(
    ext => '**/*.' + ext
  );

  return new FileWatcher(
    options.roots.map(dir => {
      if (!fs.sync.isDir(dir)) {
        throw Error('Expected a directory: "' + dir + '"');
      }
      return { dir, globs };
    })
  );
}
