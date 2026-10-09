// Persistence layer bootstrap. Opens the SQLite database and applies the
// schema migration idempotently. This is the single place that knows about
// the storage engine (P006: contract between business rules and persistence).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('rider', 'driver')),
  password    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  rider_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pickup_label   TEXT NOT NULL,
  pickup_lat     REAL NOT NULL,
  pickup_lng     REAL NOT NULL,
  dropoff_label  TEXT NOT NULL,
  dropoff_lat    REAL NOT NULL,
  dropoff_lng    REAL NOT NULL,
  distance_km    REAL NOT NULL,
  duration_min   REAL NOT NULL,
  fare_cents     INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN
                   ('requested', 'accepted', 'in_progress', 'completed', 'cancelled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS charges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id          INTEGER NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  rider_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents     INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT NOT NULL,
  gateway_ref      TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_charges_ride ON charges(ride_id);
`;

export function openDatabase(file) {
  if (file && file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
