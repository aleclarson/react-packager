
const Promise = require('Promise');
const declareOpts = require('../../utils/declareOpts');
const getPlatformExtension = require('../../utils/getPlatformExtension');

const dependencyOpts = declareOpts({
  entryFile: {
    type: 'string',
    required: true,
  },
  platform: {
    type: 'string',
    required: true,
  },
  dev: {
    type: 'boolean',
    default: true,
  },
  recursive: {
    type: 'boolean',
    default: true,
  },
  verbose: {
    type: 'boolean',
    required: false,
  }
});

module.exports = {

  getDependencies: Promise.wrap(function(options) {
    if (!options.platform) {
      options.platform = getPlatformExtension(options.entryFile);
    }

    const opts = dependencyOpts(options);
    return this._bundler.getDependencies(opts);
  }),

  getShallowDependencies: function(entryFile) {
    return this._bundler.getShallowDependencies(entryFile);
  },

  getOrderedDependencyPaths: Promise.wrap(function(options) {
    const opts = dependencyOpts(options);
    return this._bundler.getOrderedDependencyPaths(opts);
  }),
}
