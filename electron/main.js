const { app, BrowserWindow, ipcMain, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

let mainWindow = null;
let currentChild = null;
let isQuitting = false;
const macIcnsPath = path.join(__dirname, 'icon.icns');
const roundedIconPath = path.join(__dirname, 'logo-rounded.png');
const defaultIconPath = path.join(__dirname, 'logo.png');
const iconPath = (process.platform === 'darwin' && fs.existsSync(macIcnsPath))
  ? macIcnsPath
  : (fs.existsSync(roundedIconPath) ? roundedIconPath : defaultIconPath);

function getReportsDir() {
  try {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'reports');
    }
  } catch {}
  return path.join(__dirname, '..', 'reports');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 828,
    minWidth: 960,
    minHeight: 828,
    useContentSize: true,
    center: true,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  mainWindow = win;

  // When the user clicks the window close (red X), quit the app.
  // If a migration is running, confirm and cancel it first.
  win.on('close', async (e) => {
    if (isQuitting) return; // allow default close on actual quit
    e.preventDefault();

    if (currentChild) {
      const result = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Quit and Stop'],
        defaultId: 0,
        cancelId: 0,
        title: 'Migration in progress',
        message: 'A migration run is currently in progress.',
        detail: 'Closing will stop the migration and quit the app. Do you want to proceed?',
        noLink: true,
      });
      if (result.response !== 1) {
        return; // keep running
      }
      // Stop child and quit
      try { currentChild.kill('SIGTERM'); } catch {}
      await waitForChildExit(5000).catch(() => {
        try { currentChild.kill('SIGKILL'); } catch {}
      });
    }

    isQuitting = true;
    app.quit();
  });
}

app.whenReady().then(() => {
  // Set dock icon on macOS for dev runs
  try {
    if (process.platform === 'darwin' && app.dock) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock.setIcon(img);
    }
  } catch {}
  createWindow();
});

// Intercept Cmd+Q / app quit to warn if a run is in progress
app.on('before-quit', async (e) => {
  if (isQuitting) return;
  if (currentChild) {
    e.preventDefault();
    try {
      const win = mainWindow || BrowserWindow.getAllWindows()[0] || null;
      const result = await dialog.showMessageBox(win || undefined, {
        type: 'warning',
        buttons: ['Cancel', 'Quit and Stop'],
        defaultId: 0,
        cancelId: 0,
        title: 'Migration in progress',
        message: 'A migration run is currently in progress.',
        detail: 'Quitting will stop the migration and close the app. Do you want to proceed?',
        noLink: true,
      });
      if (result.response !== 1) {
        return; // abort quit
      }
      try { currentChild.kill('SIGTERM'); } catch {}
      await waitForChildExit(5000).catch(() => { try { currentChild.kill('SIGKILL'); } catch {} });
    } catch {}
  }
  isQuitting = true;
});

ipcMain.handle('save-secrets', async (event, { frontToken, googleCredentialsJson }) => {
  const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
  const secure = new store.SecureStore();

  if (frontToken && typeof frontToken === 'string' && frontToken.trim()) {
    await secure.setFrontToken(frontToken.trim());
  }
  if (googleCredentialsJson && typeof googleCredentialsJson === 'string' && googleCredentialsJson.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(googleCredentialsJson);
      if (!parsed?.installed?.client_id || !parsed?.installed?.client_secret || !parsed?.installed?.redirect_uris) {
        throw new Error('Invalid Google credentials JSON');
      }
    } catch (e) {
      throw new Error('Invalid Google credentials JSON: ' + e.message);
    }
    await secure.setGoogleCredentials(parsed);
  }
  return { ok: true };
});

ipcMain.handle('get-secrets-status', async () => {
  const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
  const secure = new store.SecureStore();
  const front = await secure.getFrontToken();
  const google = await secure.getGoogleCredentials();
  return { front: Boolean(front), google: Boolean(google) };
});

ipcMain.handle('list-front-inboxes', async () => {
  try {
    const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
    const secure = new store.SecureStore();
    const token = await secure.getFrontToken();
    if (!token) throw new Error('Front API token not configured');
    const frontMod = require(path.join(__dirname, '..', 'dist', 'api', 'front.js'));
    const baseUrl = process.env.FRONT_API_BASE_URL || 'https://api2.frontapp.com';
    const client = new frontMod.FrontClient(token, baseUrl);
    const inboxes = await client.getInboxes();
    // Return minimal fields and sort by name
    const items = (Array.isArray(inboxes) ? inboxes : []).map(x => ({ id: x.id, name: x.name })).filter(x => x.id && x.name);
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, inboxes: items };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('delete-front-token', async () => {
  const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
  const secure = new store.SecureStore();
  await secure.deleteFrontToken();
  return { ok: true };
});

ipcMain.handle('delete-google-creds', async () => {
  const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
  const secure = new store.SecureStore();
  await secure.deleteGoogleCredentials();
  return { ok: true };
});

ipcMain.handle('get-google-token-info', async () => {
  const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
  const secure = new store.SecureStore();
  const token = await secure.getGoogleToken();
  const exists = Boolean(token);
  let scopes = [];
  if (token && typeof token.scope === 'string') {
    scopes = token.scope.split(/\s+/).filter(Boolean);
  }
  return { exists, scopes };
});

ipcMain.handle('delete-google-token', async () => {
  const store = require(path.join(__dirname, '..', 'dist', 'utils', 'secureStore.js'));
  const secure = new store.SecureStore();
  await secure.deleteGoogleToken();
  return { ok: true };
});

ipcMain.handle('run-migration', (_event, opts = {}) => {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'dist', 'index.js');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    // Ensure reports dir exists and pass to child for packaged runs
    const reportsDir = getReportsDir();
    try { fs.mkdirSync(reportsDir, { recursive: true }); } catch {}
    env.REPORTS_DIR = reportsDir;
    // Always prefer keychain-stored secrets in child; drop any inherited FRONT_API_KEY
    if (env.FRONT_API_KEY) delete env.FRONT_API_KEY;
    // Apply options
    if (typeof opts.dryRun === 'boolean') {
      env.DRY_RUN = String(opts.dryRun);
    }
    if (typeof opts.logLevel === 'string' && opts.logLevel) {
      env.LOG_LEVEL = opts.logLevel;
    }
    if (typeof opts.frontInboxId === 'string') {
      if (opts.frontInboxId) env.FRONT_INBOX_ID = opts.frontInboxId; else delete env.FRONT_INBOX_ID;
    }
    // In packaged apps, __dirname/.. resolves inside app.asar (a file),
    // which is not a valid cwd and causes ENOTDIR. Use resourcesPath.
    const safeCwd = process.resourcesPath || process.cwd();
    const child = spawn(process.execPath, [script], { cwd: safeCwd, env });
    currentChild = child;

    child.stdout.on('data', data => {
      if (mainWindow) mainWindow.webContents.send('migration-data', data.toString());
    });
    child.stderr.on('data', data => {
      if (mainWindow) mainWindow.webContents.send('migration-data', data.toString());
    });
    child.on('close', code => {
      if (mainWindow) mainWindow.webContents.send('migration-end', { code });
      currentChild = null;
      if (code === 0) {
        resolve('OK');
      } else {
        reject(new Error('Exit code ' + code));
      }
    });
    child.on('error', err => {
      if (mainWindow) mainWindow.webContents.send('migration-error', { message: err.message });
    });
  });
});

ipcMain.handle('cancel-migration', () => {
  if (currentChild) {
    try { currentChild.kill('SIGTERM'); } catch {}
  }
  return { ok: true };
});

ipcMain.handle('open-reports', async () => {
  const reportsDir = getReportsDir();
  try {
    await fs.promises.mkdir(reportsDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  // Try Electron shell.openPath first
  try {
    const result = await shell.openPath(reportsDir);
    if (!result) return { ok: true, path: reportsDir };
  } catch (e) {
    // continue to fallbacks
  }

  // Fallback: openExternal file:// URL
  try {
    const url = pathToFileURL(reportsDir).toString();
    await shell.openExternal(url);
    return { ok: true, path: reportsDir };
  } catch (e) {
    // continue to system command fallback
  }

  // Final fallback: spawn platform-specific command
  try {
    await new Promise((resolve, reject) => {
      let cmd, args;
      if (process.platform === 'darwin') {
        cmd = 'open'; args = [reportsDir];
      } else if (process.platform === 'win32') {
        cmd = 'explorer'; args = [reportsDir];
      } else {
        cmd = 'xdg-open'; args = [reportsDir];
      }
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(cmd + ' exited with ' + code)));
    });
    return { ok: true, path: reportsDir };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('open-external', async (_e, url) => {
  try {
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('Invalid URL');
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

app.on('window-all-closed', () => {
  // We choose to quit on all platforms when the window is closed.
  app.quit();
});

function waitForChildExit(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!currentChild) return resolve();
    let done = false;
    const onExit = () => {
      if (done) return;
      done = true;
      currentChild = null;
      resolve();
    };
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('Timeout waiting for child to exit'));
    }, timeoutMs);
    currentChild.once('exit', () => { clearTimeout(t); onExit(); });
    currentChild.once('close', () => { clearTimeout(t); onExit(); });
    currentChild.once('error', () => { clearTimeout(t); onExit(); });
  });
}
