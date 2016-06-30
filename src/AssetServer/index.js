/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fs = require('io');
const path = require('path');
const crypto = require('crypto');
const Promise = require('Promise');

const declareOpts = require('../utils/declareOpts');
const getAssetDataFromName = require('node-haste').getAssetDataFromName;

const validateOpts = declareOpts({
  roots: {
    type: 'array',
    required: true,
  },
  extensions: {
    type: 'array',
    required: true,
  },
});

class AssetServer {
  constructor(options) {
    const opts = validateOpts(options);
    this._roots = opts.roots;
    this._extensions = opts.extensions; // TODO: Use this somewhere.
  }

  get(assetPath, platform = null) {
    const assetData = getAssetDataFromName(assetPath);
    return this._getAssetRecord(assetPath, platform).then(record => {
      for (let i = 0; i < record.scales.length; i++) {
        if (record.scales[i] >= assetData.resolution) {
          return fs.async.read(record.files[i]);
        }
      }

      return fs.async.read(record.files[record.files.length - 1]);
    });
  }

  getAssetData(assetPath, platform = null) {
    const {name, type} = getAssetDataFromName(assetPath);
    return this._getAssetRecord(assetPath, platform).then(({scales, files}) => {
      const data = {name, type, scales, files};
      return Promise.map(files, (file) => fs.async.stat(file))
      .then(({stats, scales, files}) => {
        let hash = crypto.createHash('md5');

        stats.forEach(fstat =>
          hash.update(fstat.mtime.getTime().toString()));

        hash = hash.digest('hex');
        return {hash, name, type, scales, files};
      });
    });
  }

  /**
   * Given a request for an image by path. That could contain a resolution
   * postfix, we need to find that image (or the closest one to it's resolution)
   * in one of the project roots:
   *
   * 1. We first parse the directory of the asset
   * 2. We check to find a matching directory in one of the project roots
   * 3. We then build a map of all assets and their scales in this directory
   * 4. Then try to pick platform-specific asset records
   * 5. Then pick the closest resolution (rounding up) to the requested one
   */
  _getAssetRecord(assetPath, platform = null) {
    const filename = path.basename(assetPath);
    return this._findRoot(this._roots, filename)
      .then(dir => Promise.all([
        dir,
        fs.async.readDir(dir),
      ]))
      .then(res => {
        log.format(res);
        const dir = res[0];
        const files = res[1];
        const assetData = getAssetDataFromName(filename);

        const map = this._buildAssetMap(dir, files);

        let record;
        if (platform != null){
          record = map[getAssetKey(assetData.assetName, platform)] ||
                   map[assetData.assetName];
        } else {
          record = map[assetData.assetName];
        }

        if (!record) {
          throw new Error(
            `Asset not found: ${assetPath} for platform: ${platform}`
          );
        }

        return record;
      });
  }

  _findRoot(roots, dir) {
    return Promise.map(roots, (root) => {
      const absPath = path.join(root, dir);
      console.log('assetServer._findRoot: "' + absPath + '"');
      return fs.async.isDir(absPath).then(isDirectory => {
        return {path: absPath, isDirectory};
      });
    }).then(stats => {
      for (let i = 0; i < stats.length; i++) {
        if (stats[i].isDirectory) {
          return stats[i].path;
        }
      }
      throw new Error('Could not find any directories');
    });
  }

  _buildAssetMap(dir, files) {
    const map = Object.create(null);
    files.forEach(function(file, i) {
      const {assetName, platform, resolution} = getAssetDataFromName(file);
      const assetKey = getAssetKey(assetName, platform);
      let record = map[assetKey];
      if (!record) {
        record = map[assetKey] = {
          scales: [],
          files: [],
        };
      }

      let insertIndex;
      const length = record.scales.length;

      for (insertIndex = 0; insertIndex < length; insertIndex++) {
        if (resolution <  record.scales[insertIndex]) {
          break;
        }
      }
      record.scales.splice(insertIndex, 0, resolution);
      record.files.splice(insertIndex, 0, path.join(dir, file));
    });

    return map;
  }
}

function getAssetKey(assetName, platform) {
  if (platform != null) {
    return `${assetName} : ${platform}`;
  } else {
    return assetName;
  }
}

module.exports = AssetServer;
