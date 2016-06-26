/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const inArray = require('in-array');
const sync = require('sync');
const path = require('path');

const docblock = require('../utils/docblock');
const extractRequires = require('../utils/extractRequires');

class Module {

  constructor({
    file,
    fastfs,
    moduleCache,
    cache,
    extractor = extractRequires,
    transformCode,
  }) {
    if (file[0] === '.') {
      throw Error('Path cannot be relative: ' + file);
    }

    this.path = file;
    this.type = 'Module';

    this._fastfs = fastfs;
    this._moduleCache = moduleCache;
    this._cache = cache;
    this._extractor = extractor;
    this._transformCode = transformCode;

    this._dependers = Object.create(null);
    this._dependencies = Object.create(null);
  }

  isMain() {
    return this._cache.get(
      this.path,
      'isMain',
      () => this.read().then(data => {
        const pkg = this.getPackage();
        return pkg.getMain()
        .then(mainPath => this.path === mainPath);
      })
    )
  }

  isHaste() {
    return this._cache.get(
      this.path,
      'isHaste',
      () => this._readDocBlock().then(data => {
        if (!!data.id) {
          return true;
        }
        if (!this._isHasteCompatible()) {
          return false;
        }
        return this.isMain()
        .then(isMain => {
          if (!isMain) {
            return false;
          }
          return this.getPackage()
            .getName()
            .then(name => !!name);
        });
      })
    );
  }

  getCode() {
    return this.read().then(({code}) => code);
  }

  getName() {
    return this._cache.get(
      this.path,
      'name',
      () => this._readDocBlock().then(({id}) => {
        if (id) {
          return id;
        }

        if (!this._isHasteCompatible()) {
          return path.relative(lotus.path, this.path);
        }

        const pkg = this.getPackage();
        return this.isMain()
          .then(isMain => pkg.getName().then(name =>
            isMain ? name : path.relative(lotus.path, this.path)));
      })
    )
  }

  getPackage() {
    return this._moduleCache.getPackageForModule(this);
  }

  getDependencies(transformOptions) {
    return this.read(transformOptions).then(data => data.dependencies);
  }

  getDependency(name) {
    const hash = this.path + ':' + name;
    return this._dependencies[hash];
  }

  setDependency(name, mod) {
    const hash = this.path + ':' + name;
    mod._dependers[hash] = this;
    this._dependencies[hash] = mod;
  }

  read(transformOptions) {
    return this._cache.get(
      this.path,
      cacheKey('moduleData', transformOptions),
      () => {
        const fileContentPromise = this._fastfs.readFile(this.path);
        return Promise.all([
          fileContentPromise,
          this._readDocBlock(fileContentPromise)
        ]).then(([code, {id, moduleDocBlock}]) => {
          // Ignore requires in JSON files or generated code. An example of this
          // is prebuilt files like the SourceMap library.
          if (this.isJSON() || 'extern' in moduleDocBlock) {
            return {id, code, dependencies: []};
          } else {
            const transformCode = this._transformCode;
            const codePromise = transformCode
                ? transformCode(this, code, transformOptions)
                : Promise({code});

            return codePromise.then(({code, dependencies, map}) => {
              if (!dependencies) {
                dependencies = this._extractor(code).deps.sync;
              }
              return {id, code, dependencies, map};
            });
          }
        })
      }
    );
  }

  hash() {
    return `Module : ${this.path}`;
  }

  isJSON() {
    return path.extname(this.path) === '.json';
  }

  isAsset() {
    return false;
  }

  isPolyfill() {
    return false;
  }

  isNull() {
    return false;
  }

  isAsset_DEPRECATED() {
    return false;
  }

  toJSON() {
    return {
      hash: this.hash(),
      isJSON: this.isJSON(),
      isAsset: this.isAsset(),
      isAsset_DEPRECATED: this.isAsset_DEPRECATED(),
      type: this.type,
      path: this.path,
    };
  }

  _parseDocBlock(docBlock) {
    // Extract an id for the module if it's using @providesModule syntax
    // and if it's NOT in node_modules (and not a whitelisted node_module).
    // This handles the case where a project may have a dep that has @providesModule
    // docblock comments, but doesn't want it to conflict with whitelisted @providesModule
    // modules, such as react-haste, fbjs-haste, or react-native or with non-dependency,
    // project-specific code that is using @providesModule.
    const moduleDocBlock = docblock.parseAsObject(docBlock);
    const provides = moduleDocBlock.providesModule || moduleDocBlock.provides;

    const id = provides && !this._depGraphHelpers.isNodeModulesDir(this.path)
        ? /^\S+/.exec(provides)[0]
        : undefined;
    return {id, moduleDocBlock};
  }

  _readDocBlock(contentPromise) {
    if (!this._docBlock) {
      if (!contentPromise) {
        contentPromise = this._fastfs.readWhile(this.path, whileInDocBlock);
      }
      this._docBlock = contentPromise
        .then(docBlock => this._parseDocBlock(docBlock));
    }
    return this._docBlock;
  }

  // We don't want 'node_modules' to be haste paths
  // unless the package is a watcher root.
  _isHasteCompatible() {
    const pkg = this.getPackage();
    if (!pkg) {
      return false;
    }
    if (!/node_modules/.test(this.path)) {
      return true;
    }
    return inArray(this._fastfs._roots, pkg.root);
  }

  _processFileChange(type) {

    var newModule;

    // Force this Module to recache its data.
    this._cache.invalidate(this.path);

    // Remove this Module from its ModuleCache.
    this._moduleCache.removeModule(this.path);

    // Any old dependencies should NOT have this Module
    // in their `_dependers` hash table.
    sync.each(this._dependencies, (mod, hash) => {
      delete mod._dependers[hash];
    });

    if (type === 'delete') {

      // Catch other Modules still depending on this deleted Module.
      sync.each(this._dependers, (mod, hash) => {
        delete mod._dependencies[hash];
      });

    } else {

      // Force the ModuleCache to regenerate this Module.
      newModule = this._moduleCache.getModule(this.path);

      // Force any Modules (that depend on the old Module)
      // to depend on the new Module.
      sync.each(this._dependers, (mod, hash) => {
        mod._dependencies[hash] = newModule;
        newModule._dependers[hash] = mod;
      });
    }
  }
}

function whileInDocBlock(chunk, i, result) {
  // consume leading whitespace
  if (!/\S/.test(result)) {
    return true;
  }

  // check for start of doc block
  if (!/^\s*\/(\*{2}|\*?$)/.test(result)) {
    return false;
  }

  // check for end of doc block
  return !/\*\//.test(result);
}

// use weak map to speed up hash creation of known objects
const knownHashes = new WeakMap();
function stableObjectHash(object) {
  let digest = knownHashes.get(object);

  if (!digest) {
    const hash = crypto.createHash('md5');
    stableObjectHash.addTo(object, hash);
    digest = hash.digest('base64');
    knownHashes.set(object, digest);
  }

  return digest;
}
stableObjectHash.addTo = function addTo(value, hash) {
  if (value === null || typeof value !== 'object') {
    hash.update(JSON.stringify(value));
  } else {
    Object.keys(value).sort().forEach(key => {
      const valueForKey = value[key];
      if (valueForKey !== undefined) {
        hash.update(key);
        addTo(valueForKey, hash);
      }
    });
  }
};

function cacheKey(field, transformOptions) {
  return transformOptions !== undefined
      ? stableObjectHash(transformOptions) + '\0' + field
      : field;
}

module.exports = Module;
