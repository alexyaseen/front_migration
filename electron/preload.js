const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  runMigration: () => ipcRenderer.invoke('run-migration')
});
