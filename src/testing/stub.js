// Test helper: stands in for a module before the code under test requires it.
const path = require("path");

/** Puts `exports` in the require cache as src/<relative> (e.g. "config/database.js"). */
function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

module.exports = { stub };
