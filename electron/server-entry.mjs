// Embedded-server entry for the desktop app. The Electron main process forks
// this with `--experimental-sqlite` (as a plain Node process via
// ELECTRON_RUN_AS_NODE), it starts the real UrbanoFlashCar API+UI on an
// ephemeral localhost port and reports that port back over IPC. This reuses the
// exact same backend as the web/PWA build — no divergent code path.

import { createServer } from 'node:http';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

const db = openDatabase(config.databaseFile);
const server = createServer(createApp(db, config));

server.listen(Number(process.env.PORT) || 0, process.env.HOST || '127.0.0.1', () => {
  const { port } = server.address();
  if (process.send) process.send({ port });
  else console.log(`embedded server on 127.0.0.1:${port} (db: ${config.databaseFile})`);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
