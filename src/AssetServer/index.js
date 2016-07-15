/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const {getAssetDataFromName, matchExtensions} = require('node-haste');

const fs = require('io');
const path = require('path');
const crypto = require('crypto');
const Promise = require('Promise');

const declareOpts = require('../utils/declareOpts');

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
    this.roots = opts.roots;
    this.extensions = opts.extensions;
  }

  get(assetPath, platform = null) {
    const {resolution} = getAssetDataFromName(assetPath);
    return this._getAssetRecord(assetPath, platform).then(record => {
      let filePath;
      const fileCount = record.files.length;
      for (let i = 0; i < fileCount; i++) {
        if (record.scales[i] >= resolution) {
          filePath = record.files[i];
          break;
        }
      }
      if (!filePath) {
        // Load the largest possible scale.
        filePath = record.files[fileCount - 1];
      }

      return fs.async.read(filePath, {encoding: null});
    });
  }

  getAssetData(assetPath, platform = null) {
    const {name, type} = getAssetDataFromName(assetPath);
    return this._getAssetRecord(assetPath, platform).then(({scales, files}) => {
      return Promise.map(files, fs.async.stats).then(stats => {
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
    this._assertRoot(this.roots, assetPath);
    const dir = path.dirname(assetPath);
    const exts = this.extensions.length === 1 ? this.extensions[0] : '{' + this.extensions.join(',') + '}';
    return fs.async.match(dir + '/*.' + exts)
    .then(files => {
      const asset = getAssetDataFromName(path.basename(assetPath));
      const assetName = asset.name + '.' + asset.type;

      const map = this._buildAssetMap(dir, files);

      let record;
      if (platform != null){
        record = map[getAssetKey(assetName, platform)] ||
                 map[assetName];
      } else {
        record = map[assetName];
      }

      if (!record) {
        throw new Error(
          `Asset not found: ${assetPath} for platform: ${platform}`
        );
      }

      return record;
    });
  }

  _assertRoot(roots, filename) {
    for (let i = 0; i < roots.length; i++) {
      if (filename.startsWith(roots[i])) {
        return;
      }
    }
    throw new Error(`File has unknown root: '${filename}'`);
  }

  _buildAssetMap(dir, files) {
    const map = Object.create(null);
    files.forEach((assetPath, i) => {
      if (!matchExtensions(this.extensions, assetPath)) {
        return;
      }

      const asset = getAssetDataFromName(path.basename(assetPath));
      const assetKey = getAssetKey(asset.name + '.' + asset.type, asset.platform);
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
        if (asset.resolution <  record.scales[insertIndex]) {
          break;
        }
      }
      record.scales.splice(insertIndex, 0, asset.resolution);
      record.files.splice(insertIndex, 0, assetPath);
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
