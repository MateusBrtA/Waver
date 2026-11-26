const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onState: (cb) => {
    ipcRenderer.on('overlay:render', (_e, state) => cb(state));
  },
});
