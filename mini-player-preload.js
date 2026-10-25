const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniPlayer', {
  onState: (cb) => ipcRenderer.on('mini-state', (e, d) => cb(d)),
  onMode: (cb) => ipcRenderer.on('mini-mode', (e, d) => cb(d)),
  command: (cmd, value) => ipcRenderer.send('mini-cmd', { cmd, value }),
  action: (name) => ipcRenderer.send('mini-action', name),
  drag: (phase, x, y) => ipcRenderer.send('mini-drag', { phase, x, y }),
});
