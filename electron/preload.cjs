const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  // Returns an unsubscribe function.
  onThemeChange: (callback) => {
    const listener = (_event, theme) => callback(theme === 'dark' ? 'dark' : 'light');
    ipcRenderer.on('theme-change', listener);
    return () => ipcRenderer.removeListener('theme-change', listener);
  },
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
});
