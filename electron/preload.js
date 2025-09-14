const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveSecrets: (frontToken, googleCredentialsJson) => ipcRenderer.invoke('save-secrets', { frontToken, googleCredentialsJson }),
  runMigration: () => ipcRenderer.invoke('run-migration'),
  cancelMigration: () => ipcRenderer.invoke('cancel-migration'),
  onMigrationData: (callback) => ipcRenderer.on('migration-data', (_e, chunk) => callback(chunk)),
  onMigrationEnd: (callback) => ipcRenderer.on('migration-end', (_e, payload) => callback(payload)),
  onMigrationError: (callback) => ipcRenderer.on('migration-error', (_e, payload) => callback(payload)),
});
