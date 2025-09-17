const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'dist');

try {
  fs.rmSync(outDir, { recursive: true, force: true });
} catch (err) {
  console.warn(`Failed to clean dist: ${err.message}`);
}
