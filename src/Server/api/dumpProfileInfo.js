/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const {exec} = require('child_process');

const fs = require('io');
const path = require('path');

module.exports = function dumpProfileInfo(req, res) {
  console.log('Dumping profile information...');
  const dumpName = '/tmp/dump_' + Date.now() + '.json';
  const prefix = process.env.TRACE_VIEWER_PATH || '';
  const cmd = path.join(prefix, 'trace2html') + ' ' + dumpName;
  fs.sync.write(dumpName, req.rawBody);
  exec(cmd, error => {
    if (error) {
      if (error.code === 127) {
        console.error(
          '\n** Failed executing `' + cmd + '` **\n\n' +
          'Google trace-viewer is required to visualize the data, do you have it installled?\n\n' +
          'You can get it at:\n\n' +
          '  https://github.com/google/trace-viewer\n\n' +
          'If it\'s not in your path,  you can set a custom path with:\n\n' +
          '  TRACE_VIEWER_PATH=/path/to/trace-viewer\n\n' +
          'NOTE: Your profile data was kept at:\n\n' +
          '  ' + dumpName
        );
      } else {
        console.error('Unknown error', error);
      }
      res.end();
      return;
    } else {
      exec('rm ' + dumpName);
      exec('open ' + dumpName.replace(/json$/, 'html'), err => {
        if (err) {
          console.error(err);
        }
        res.end();
      });
    }
  });
}
