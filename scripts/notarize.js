/* eslint-disable no-console */
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// Called by electron-builder after signing artifacts
exports.default = async function notarize(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const shouldNotarize = process.env.MAC_NOTARIZE !== 'false';
  if (!shouldNotarize) {
    console.log('[notarize] Skipping notarization (MAC_NOTARIZE=false)');
    return;
  }

  const appId = packager.appInfo.id;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  // Prefer App Store Connect API key if available
  const ascApiKeyId = process.env.ASC_KEY_ID;
  const ascIssuerId = process.env.ASC_ISSUER_ID;
  const ascKeyFile = process.env.ASC_KEY_FILE; // path to .p8

  try {
    const { notarize } = require('@electron/notarize');

    if (ascApiKeyId && ascIssuerId && ascKeyFile) {
      console.log('[notarize] Using App Store Connect API key');
      await notarize({
        appBundleId: appId,
        appPath,
        tool: 'notarytool',
        appleApiKey: ascKeyFile,
        appleApiKeyId: ascApiKeyId,
        appleApiIssuer: ascIssuerId,
      });
      console.log('[notarize] Notarization complete via notarytool (API key)');
      await staple(appPath);
      return;
    }

    // Fallback to Apple ID + app-specific password
    const appleId = process.env.APPLE_ID;
    const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;
    if (!appleId || !applePassword) {
      console.log('[notarize] Missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD; skipping notarization');
      return;
    }

    console.log('[notarize] Using Apple ID credentials');
    await notarize({
      appBundleId: appId,
      appPath,
      tool: 'notarytool',
      appleId,
      appleIdPassword: applePassword,
      teamId,
    });
    console.log('[notarize] Notarization complete via notarytool (Apple ID)');
    await staple(appPath);
  } catch (e) {
    console.warn('[notarize] Skipped (module missing or error):', e && e.message ? e.message : e);
  }
};

async function staple(targetPath) {
  try {
    console.log('[staple] Stapling:', targetPath);
    await execFileAsync('xcrun', ['stapler', 'staple', '-v', targetPath], { stdio: 'inherit' });
    console.log('[staple] Stapled successfully');
  } catch (e) {
    console.warn('[staple] Failed to staple:', e && e.message ? e.message : e);
  }
}
