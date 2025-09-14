const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let currentChild = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  mainWindow = win;
}

app.whenReady().then(createWindow);

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
    // Apply options
    if (typeof opts.dryRun === 'boolean') {
      env.DRY_RUN = String(opts.dryRun);
    }
    if (typeof opts.logLevel === 'string' && opts.logLevel) {
      env.LOG_LEVEL = opts.logLevel;
    }
    const child = spawn(process.execPath, [script], {
      cwd: path.join(__dirname, '..'),
      env,
    });
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
