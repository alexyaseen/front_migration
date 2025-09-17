const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

// electron-builder invokes this hook after the app directory has been prepared.
// We prune devDependencies from the packaged app to keep the final artifact lean
// without touching the workspace node_modules used for tooling.
module.exports = async function prunePackagedDependencies(context) {
  const appPath = path.join(context.appOutDir, 'resources', 'app');
  const nodeModulesPath = path.join(appPath, 'node_modules');

  if (!fs.existsSync(nodeModulesPath)) {
    return; // nothing to prune
  }

  await execAsync('npm prune --production', { cwd: appPath });
};
