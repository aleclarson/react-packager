/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const debug = require('debug')('ReactNativePackager:JStransformer');

const fs = require('io');
const os = require('os');
const Promise = require('Promise');
const temp = require('temp');
const util = require('util');
const workerFarm = require('worker-farm');

const declareOpts = require('../utils/declareOpts');
const ModuleTransport = require('../utils/ModuleTransport');

const workerModulePath = JSON.stringify(require.resolve('./worker'));

// Avoid memory leaks caused in workers. This number seems to be a good enough number
// to avoid any memory leak while not slowing down initial builds.
// TODO(amasad): Once we get bundle splitting, we can drive this down a bit more.
const MAX_CALLS_PER_WORKER = 600;

// Worker will timeout if one of the callers timeout.
const DEFAULT_MAX_CALL_TIME = 301000;

// How may times can we tolerate failures from the worker.
const MAX_RETRIES = 2;

const validateOpts = declareOpts({
  projectRoots: {
    type: 'array',
    required: true,
  },
  polyfillModuleNames: {
    type: 'array',
    default: [],
  },
  transformModulePath: {
    type:'string',
    required: false,
  },
  cache: {
    type: 'object',
    required: true,
  },
  fastfs: {
    type: 'object',
    required: true,
  },
  transformTimeoutInterval: {
    type: 'number',
    default: DEFAULT_MAX_CALL_TIME,
  },
  disableInternalTransforms: {
    type: 'boolean',
    default: false,
  },
});

const maxConcurrentWorkers = ((cores, override) => {
  if (override) {
    return Math.min(cores, override);
  }

  if (cores < 3) {
    return cores;
  }
  if (cores < 8) {
    return Math.floor(cores * 0.75);
  }
  if (cores < 24) {
    return Math.floor(3/8 * cores + 3); // between cores *.75 and cores / 2
  }
  return cores / 2;
})(os.cpus().length, process.env.REACT_NATIVE_MAX_WORKERS);

class Transformer {
  constructor(options) {
    const opts = this._opts = validateOpts(options);

    this._cache = opts.cache;
    this._fastfs = opts.fastfs;
    this._projectRoots = opts.projectRoots;
    this._transformModulePath = opts.transformModulePath;

    if (opts.transformModulePath != null) {
      let transformer;

      if (opts.disableInternalTransforms) {
        transformer = opts.transformModulePath;
      } else {
        transformer = this._workerWrapperPath = temp.path();
        fs.sync.write(
          this._workerWrapperPath,
          `
          module.exports = require(${JSON.stringify(require.resolve('./worker'))});
          require(${JSON.stringify(String(opts.transformModulePath))});
          `
        );
      }

      this._workers = workerFarm({
        autoStart: true,
        maxConcurrentCallsPerWorker: 1,
        maxConcurrentWorkers: maxConcurrentWorkers,
        maxCallsPerWorker: MAX_CALLS_PER_WORKER,
        maxCallTime: opts.transformTimeoutInterval,
        maxRetries: MAX_RETRIES,
      }, transformer);

      this._transform = Promise.ify(this._workers);
    }
  }

  kill() {
    this._workers && workerFarm.end(this._workers);
    if (this._workerWrapperPath &&
        typeof this._workerWrapperPath === 'string') {
      fs.sync.remove(this._workerWrapperPath);
    }
  }

  invalidateFile(filePath) {
    this._cache.invalidate(filePath);
  }

  loadFileAndTransform(filePath, options) {
    if (this._transform == null) {
      return Promise.reject(new Error('No transfrom module'));
    }

    debug('transforming file', filePath);

    const optionsJSON = JSON.stringify(options);

    return this._cache.get(
      filePath,
      'transformedSource-' + optionsJSON,
      () => this._fastfs.readFile(filePath)
        .then(buffer => {
          const sourceCode = buffer.toString('utf8');
          return this._transform({
            sourceCode,
            filename: filePath,
            options: {
              ...options,
              projectRoots: this._projectRoots,
              externalTransformModulePath: this._transformModulePath,
            },
          }).then(res => {
            if (res.error) {
              console.warn(
                'Error property on the result value from the transformer',
                'module is deprecated and will be removed in future versions.',
                'Please pass an error object as the first argument to the callback'
              );
              throw formatError(res.error, filePath);
            }

            return new ModuleTransport({
              code: res.code,
              map: res.map,
              sourcePath: filePath,
              sourceCode: sourceCode,
            });
          }).fail(err => {
            if (err.type === 'TimeoutError') {
              const timeoutErr = new Error(
                `TimeoutError: transforming ${filePath} took longer than ` +
                `${this._opts.transformTimeoutInterval / 1000} seconds.\n` +
                `You can adjust timeout via the 'transformTimeoutInterval' option`
              );
              timeoutErr.type = 'TimeoutError';
              throw timeoutErr;
            } else if (err.type === 'ProcessTerminatedError') {
              const uncaughtError = new Error(
                'Uncaught error in the transformer worker: ' +
                this._opts.transformModulePath
              );
              uncaughtError.type = 'ProcessTerminatedError';
              throw uncaughtError;
            }

            throw formatError(err, filePath);
          });
        })
    );
  }
}


module.exports = Transformer;

Transformer.TransformError = TransformError;

function TransformError() {
  Error.captureStackTrace && Error.captureStackTrace(this, TransformError);
}
util.inherits(TransformError, SyntaxError);

function formatError(err, filename, source) {
  if (err.loc) {
    return formatBabelError(err, filename, source);
  } else {
    return formatGenericError(err, filename, source);
  }
}

function formatGenericError(err, filename) {
  var msg = 'TransformError: ' + filename + ': ' + err.message;
  var error = new TransformError();
  var stack = (err.stack || '').split('\n').slice(0, -1);
  stack.push(msg);
  error.stack = stack.join('\n');
  error.message = msg;
  error.type = 'TransformError';
  return error;
}

function formatBabelError(err, filename) {
  var error = new TransformError();
  error.type = 'TransformError';
  error.message = (err.type || error.type) + ' ' + err.message;
  error.stack = err.stack;
  error.snippet = err.codeFrame;
  error.lineNumber = err.loc.line;
  error.column = err.loc.column;
  error.filename = filename;
  error.description = err.message;
  return error;
}
