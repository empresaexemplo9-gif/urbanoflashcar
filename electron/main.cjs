// UrbanoFlashCar desktop (Electron) main process.
//
// By default it embeds the real server (forked with --experimental-sqlite,
// data stored in the OS user-data directory) so the desktop app is
// self-contained. Set UFC_SERVER_URL to point the window at a remote/hosted
// backend instead (then no local server is started).

const { app, BrowserWindow, shell, session } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

// Allow the renderer to request geolocation. Electron denies permissions by
// default; the app uses the real current location (with an IP-based fallback
// in the UI for when the bundled Chromium has no geolocation service).
function allowGeolocation() {
  try {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'geolocation'));
    if (ses.setPermissionCheckHandler) {
      ses.setPermissionCheckHandler((wc, permission) => permission === 'geolocation');
    }
  } catch (err) {
    console.error('[ufc-geo]', err && err.message ? err.message : err);
  }
}

// Keep the installed desktop app in lockstep with the platform: check GitHub
// Releases on launch and install the new version on quit. Only meaningful for
// a packaged build that runs the embedded server (the bundled binary carries
// both server and UI); a hosted build (UFC_SERVER_URL) updates its UI through
// the web auto-update path instead.
function setupDesktopAutoUpdate() {
  if (!app.isPackaged || process.env.UFC_SERVER_URL) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('error', (err) => console.error('[ufc-update]', err?.message || err));
    autoUpdater.on('update-available', (info) => console.log('[ufc-update] nova versão', info?.version));
    autoUpdater.on('update-downloaded', (info) => console.log('[ufc-update] baixada', info?.version, '— instala ao sair'));
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('[ufc-update]', err?.message || err));
    // Re-check periodically for long-running sessions (every 6 hours).
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  } catch (err) {
    console.error('[ufc-update] indisponível:', err?.message || err);
  }
}

// A STABLE localhost port keeps the web origin constant across launches, so the
// session token the UI stores in localStorage (which is scoped by origin) and
// the service-worker caches survive restarts. Override with UFC_PORT if needed.
const DEFAULT_PORT = Number(process.env.UFC_PORT) || 31977;

let serverProc = null;
let serverPort = null;

function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    const dbFile = path.join(app.getPath('userData'), 'urbanoflashcar.db');
    const child = fork(path.join(__dirname, 'server-entry.mjs'), [], {
      execArgv: ['--experimental-sqlite'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DATABASE_FILE: dbFile,
        HOST: '127.0.0.1',
        PORT: String(DEFAULT_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    serverProc = child;

    const timer = setTimeout(() => reject(new Error('timeout ao iniciar o servidor embutido')), 15000);
    child.on('message', (msg) => {
      if (msg && msg.port) {
        clearTimeout(timer);
        serverPort = msg.port;
        resolve(msg.port);
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      if (!serverPort) { clearTimeout(timer); reject(new Error(`servidor encerrou (código ${code})`)); }
    });
    child.stderr?.on('data', (d) => console.error('[ufc-server]', String(d).trim()));
  });
}

async function resolveAppUrl() {
  if (process.env.UFC_SERVER_URL) return process.env.UFC_SERVER_URL.replace(/\/$/, '');
  const port = await startEmbeddedServer();
  return `http://127.0.0.1:${port}`;
}

function errorPage(message) {
  const safe = String(message).replace(/</g, '&lt;');
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      `<!doctype html><html lang="pt-BR"><body style="font-family:system-ui;background:#0f1419;color:#e8ecf1;padding:32px">
      <h1>⚡ UrbanoFlashCar</h1>
      <p>Não foi possível iniciar o servidor embutido.</p>
      <pre style="background:#1a2029;padding:12px;border-radius:8px;white-space:pre-wrap">${safe}</pre>
      <p>Defina <code>UFC_SERVER_URL</code> para usar um servidor hospedado.</p>
      </body></html>`,
    )
  );
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 440,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#0f1419',
    title: 'UrbanoFlashCar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (typeof win.removeMenu === 'function') win.removeMenu();

  // Keep basic recovery shortcuts even without a menu: reload (Ctrl/Cmd+R) and
  // toggle DevTools (Ctrl+Shift+I / Cmd+Alt+I / F12), so a user is never stuck.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    const mod = input.control || input.meta;
    if (mod && key === 'r') { win.webContents.reloadIgnoringCache(); event.preventDefault(); }
    else if (key === 'f12' || (mod && input.shift && key === 'i') || (input.meta && input.alt && key === 'i')) {
      win.webContents.toggleDevTools(); event.preventDefault();
    }
  });

  win.loadURL(url);
  // Open any external link in the system browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  return win;
}

// Single-instance lock: a second launch focuses the running window instead of
// starting another server on a different port. Together with the fixed port
// above this guarantees a single, stable origin for the whole app lifetime.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(async () => {
    allowGeolocation();
    let url;
    try {
      url = await resolveAppUrl();
    } catch (err) {
      console.error('Falha ao iniciar:', err);
      url = errorPage(err.message);
    }
    console.log('[ufc-desktop] ready at', url);
    createWindow(url);
    setupDesktopAutoUpdate();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

app.on('quit', () => {
  if (serverProc) { try { serverProc.kill(); } catch { /* already gone */ } }
});
