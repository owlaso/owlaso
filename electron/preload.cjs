const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  onThemeChange: (callback) => {
    ipcRenderer.on('theme-change', (_event, theme) => callback(theme));
  },
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
});