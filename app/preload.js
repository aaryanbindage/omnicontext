const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omni', {
  call: (method, ...args) => ipcRenderer.invoke('omni', method, ...args),
});
