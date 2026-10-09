// Minimal, safe preload: exposes only read-only version info to the page.
// contextIsolation is on and nodeIntegration is off, so the web app keeps
// running exactly as it does in the browser.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ufcDesktop', {
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
