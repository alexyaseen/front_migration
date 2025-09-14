const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveSecrets: (frontToken, googleCredentialsJson) => ipcRenderer.invoke('save-secrets', { frontToken, googleCredentialsJson }),
  runMigration: (opts) => ipcRenderer.invoke('run-migration', opts),
  cancelMigration: () => ipcRenderer.invoke('cancel-migration'),
  clearMigrationListeners: () => {
    ipcRenderer.removeAllListeners('migration-data');
    ipcRenderer.removeAllListeners('migration-end');
    ipcRenderer.removeAllListeners('migration-error');
  },
  onMigrationData: (callback) => ipcRenderer.on('migration-data', (_e, chunk) => callback(chunk)),
  onMigrationEnd: (callback) => ipcRenderer.on('migration-end', (_e, payload) => callback(payload)),
  onMigrationError: (callback) => ipcRenderer.on('migration-error', (_e, payload) => callback(payload)),
});
