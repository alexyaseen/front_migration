const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveSecrets: (frontToken, googleCredentialsJson) => ipcRenderer.invoke('save-secrets', { frontToken, googleCredentialsJson }),
  getSecretsStatus: () => ipcRenderer.invoke('get-secrets-status'),
  deleteFrontToken: () => ipcRenderer.invoke('delete-front-token'),
  deleteGoogleCreds: () => ipcRenderer.invoke('delete-google-creds'),
  getGoogleTokenInfo: () => ipcRenderer.invoke('get-google-token-info'),
  deleteGoogleToken: () => ipcRenderer.invoke('delete-google-token'),
  openReports: () => ipcRenderer.invoke('open-reports'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
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
