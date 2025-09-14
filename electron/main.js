const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

ipcMain.handle('run-migration', () => {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'dist', 'index.js');
    const child = spawn(process.execPath, [script], { cwd: path.join(__dirname, '..') });

    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.on('close', code => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(output);
      }
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
