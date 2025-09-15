/* eslint-disable no-console */
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

exports.default = async function stapleArtifacts(context) {
  const { electronPlatformName, artifactPaths } = context;
  if (electronPlatformName !== 'darwin') return;

  for (const artifact of artifactPaths || []) {
    if (!artifact) continue;
    if (artifact.endsWith('.dmg') || artifact.endsWith('.pkg') || artifact.endsWith('.app')) {
      try {
        console.log('[staple] Stapling artifact:', artifact);
        await execFileAsync('xcrun', ['stapler', 'staple', '-v', artifact], { stdio: 'inherit' });
        console.log('[staple] Stapled OK:', path.basename(artifact));
      } catch (e) {
        console.warn('[staple] Failed to staple', artifact, e && e.message ? e.message : e);
      }
    }
  }
};

