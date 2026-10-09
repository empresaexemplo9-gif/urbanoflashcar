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

-- Payment is settled DIRECTLY with the driver (Pix or physical card machine).
-- There is no online gateway: a payment is created "pending" when the ride is
-- completed and the driver marks it "received", recording how it was paid.
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id       INTEGER NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  rider_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_cents  INTEGER NOT NULL,
  method        TEXT CHECK (method IN ('pix', 'card')),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'received')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Favorite routes a rider saves for quick re-use on the home screen.
CREATE TABLE IF NOT EXISTS favorites (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  pickup_label   TEXT NOT NULL,
  pickup_lat     REAL NOT NULL,
  pickup_lng     REAL NOT NULL,
  dropoff_label  TEXT NOT NULL,
  dropoff_lat    REAL NOT NULL,
  dropoff_lng    REAL NOT NULL,
  created_at     TEXT NOT NULL
);

-- Driver presence: whether a driver is online and their last known location,
-- used to find nearby partner drivers for a pickup.
CREATE TABLE IF NOT EXISTS driver_status (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available   INTEGER NOT NULL DEFAULT 0,
  lat         REAL,
  lng         REAL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_ride ON payments(ride_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
`;

// One-time backfill for databases created by a previous release that used a
// `charges` table: copy each charge that has no payment yet into `payments`,
// so no completed ride is left out of the payment workflow after the upgrade.
// Old "paid" charges become "received"; everything else becomes "pending".
const BACKFILL_CHARGES = `
INSERT INTO payments (ride_id, rider_id, driver_id, amount_cents, method, status, created_at, updated_at)
SELECT c.ride_id, c.rider_id, r.driver_id, c.amount_cents, NULL,
       CASE WHEN c.status = 'paid' THEN 'received' ELSE 'pending' END,
       c.created_at, c.updated_at
FROM charges c
JOIN rides r ON r.id = c.ride_id
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = c.ride_id);
`;

export function openDatabase(file) {
  if (file && file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const hasCharges = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'charges'")
    .get();
  if (hasCharges) db.exec(BACKFILL_CHARGES);

  return db;
}
