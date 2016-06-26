
const _ = require('underscore');
const _fs = require('fs');
const path = require('path');

class File {
  constructor(filePath, { isDir, isDetached }) {
    this.path = filePath;
    this.isDir = Boolean(isDir);
    this.isDetached = Boolean(isDetached);
    if (this.isDir) {
      this.children = Object.create(null);
    }
    if (this.isDetached) {
      this.getFileFromPath = (filePath) =>
        this._getFileFromPath(filePath) ||
          this._createFileFromPath(filePath);
    }
  }

  read() {
    if (!this._read) {
      this._read = fs.async.read(this.path);
    }

    return this._read;
  }

  readWhile(predicate) {
    return readWhile(this.path, predicate).then(({result, completed}) => {
      if (completed && !this._read) {
        this._read = Promise(result);
      }
      return result;
    });
  }

  stat() {
    if (!this._stat) {
      this._stat = fs.async.stats(this.path);
    }

    return this._stat;
  }

  addChild(file) {
    const parts = path.relative(this.path, file.path).split(path.sep);

    if (parts.length === 0) {
      return;
    }

    if (parts.length === 1) {
      this.children[parts[0]] = file;
      file.parent = this;
    } else if (this.children[parts[0]]) {
      this.children[parts[0]].addChild(file);
    } else {
      const dir = new File(path.join(this.path, parts[0]), { isDir: true });
      dir.parent = this;
      this.children[parts[0]] = dir;
      dir.addChild(file);
    }
  }

  getFileFromPath(filePath) {
    return this._getFileFromPath(filePath);
  }

  getFiles() {
    let files = [];
    Object.keys(this.children).forEach(key => {
      const file = this.children[key];
      if (file.isDir) {
        files = files.concat(file.getFiles());
      } else {
        files.push(file);
      }
    });
    return files;
  }

  ext() {
    return path.extname(this.path).replace(/^\./, '');
  }

  remove() {
    if (!this.parent) {
      throw new Error(`No parent to delete ${this.path} from`);
    }

    delete this.parent.children[path.basename(this.path)];
  }

  _getFileFromPath(filePath) {
    const parts = path.relative(this.path, filePath)
            .split(path.sep);

    /*eslint consistent-this:0*/
    let file = this;
    for (let i = 0; i < parts.length; i++) {
      let fileName = parts[i];
      if (!fileName) {
        continue;
      }

      if (!file || !file.isDir) {
        // File not found.
        return null;
      }

      file = file.children[fileName];
    }

    return file;
  }

  _createFileFromPath(filePath) {
    var file = this;
    const parts = path.relative(this.path, filePath).split(path.sep);
    parts.forEach((part, i) => {
      const newPath = file.path + "/" + part;
      var newFile = this._getFileFromPath(newPath);
      if (newFile == null) {
        let isDir = i < parts.length - 1;
        let isValid = isDir ? fs.sync.isDir : fs.sync.isFile;
        if (!isValid(newPath)) {
          let fileType = isDir ? 'directory' : 'file';
          let error = Error('"' + newPath + '" is not a ' + fileType + ' that exists.');
          error.code = 404;
          throw error;
        }
        newFile = new File(newPath, { isDir: isDir });
        file.addChild(newFile);

        if (isDir) {
          let pkgJsonPath = newPath + '/package.json';
          if (fs.sync.isFile(pkgJsonPath)) {
            let pkgJson = new File(pkgJsonPath, { isDir: false });
            newFile.addChild(pkgJson);
          }
        }
      }
      file = newFile;
    });
    return file;
  }
}

module.exports = File;

/*
 * Internal helpers
 */

function readWhile(filePath, predicate) {
  return Promise.resolve((resolve, reject) => {
    _fs.open(filePath, 'r', (openError, fd) => {
      if (openError) {
        reject(openError);
        return;
      }

      read(
        fd,
        /*global Buffer: true*/
        new Buffer(512),
        makeReadCallback(fd, predicate, (readError, result, completed) => {
          if (readError) {
            reject(readError);
          } else {
            resolve({result, completed});
          }
        })
      );
    });
  });
}

function read(fd, buffer, callback) {
  _fs.read(fd, buffer, 0, buffer.length, -1, callback);
}

function close(fd, error, result, complete, callback) {
  _fs.close(fd, closeError => callback(error || closeError, result, complete));
}

function makeReadCallback(fd, predicate, callback) {
  let result = '';
  let index = 0;
  return function readCallback(error, bytesRead, buffer) {
    if (error) {
      close(fd, error, undefined, false, callback);
      return;
    }

    const completed = bytesRead === 0;
    const chunk = completed ? '' : buffer.toString('utf8', 0, bytesRead);
    result += chunk;
    if (completed || !predicate(chunk, index++, result)) {
      close(fd, null, result, completed, callback);
    } else {
      read(fd, buffer, readCallback);
    }
  };
}
