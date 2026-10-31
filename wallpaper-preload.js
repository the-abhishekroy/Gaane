const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaper', {
  onFrame: (cb) => ipcRenderer.on('wallpaper-frame', (e, d) => cb(d)),
  onConfig: (cb) => ipcRenderer.on('wallpaper-config', (e, d) => cb(d)),
  ready: () => ipcRenderer.send('wallpaper-ready'),
});
