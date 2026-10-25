const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edgeOverlay', {
  onFrame: (cb) => ipcRenderer.on('edge-frame', (e, d) => cb(d)),
  onConfig: (cb) => ipcRenderer.on('edge-config', (e, d) => cb(d)),
});
