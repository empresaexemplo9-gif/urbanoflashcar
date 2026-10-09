// Entry point: opens the real database, builds the app and starts listening.
// Graceful shutdown closes the HTTP server and the database so WAL data is
// flushed (relevant for data continuity, P002, and clean deploys, P010).

import { createServer } from 'node:http';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const db = openDatabase(config.databaseFile);
const server = createServer(createApp(db, config));

server.listen(config.port, config.host, () => {
  console.log(`UrbanoFlashCar ouvindo em http://${config.host}:${config.port}`);
  console.log(`Banco de dados: ${config.databaseFile}`);
});

function shutdown(signal) {
  console.log(`\nRecebido ${signal}, encerrando...`);
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  // Safety net if connections hang.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
