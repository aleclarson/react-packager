
const path = require('path');

module.exports = (root, child) => {
  return path.relative(root, child).indexOf('..') !== 0;
};
