// UrbanoFlashCar desktop (Electron) main process.
//
// By default it embeds the real server (forked with --experimental-sqlite,
// data stored in the OS user-data directory) so the desktop app is
// self-contained. Set UFC_SERVER_URL to point the window at a remote/hosted
// backend instead (then no local server is started).

const { app, BrowserWindow, shell } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

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
        PORT: '0',
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
  win.loadURL(url);
  // Open any external link in the system browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  return win;
}

app.whenReady().then(async () => {
  let url;
  try {
    url = await resolveAppUrl();
  } catch (err) {
    console.error('Falha ao iniciar:', err);
    url = errorPage(err.message);
  }
  console.log('[ufc-desktop] ready at', url);
  createWindow(url);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  if (serverProc) { try { serverProc.kill(); } catch { /* already gone */ } }
});
