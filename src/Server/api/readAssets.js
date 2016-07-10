
const parseURLForBundleOptions = require('../utils/parseURLForBundleOptions');

module.exports = function readAssets(req, res) {
  const options = parseURLForBundleOptions(req.url);
  const hash = JSON.stringify(options);
  return this.buildBundle(hash, options)
  .then(bundle => {
    res.setHeader('Content-Type', 'application/json');
    return JSON.stringify(
      bundle.getAssets()
    );
  });
}
