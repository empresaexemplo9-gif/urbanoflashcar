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
  -- Ride category/tier (economy | comfort | xl) and the price breakdown that
  -- produced fare_cents: base_fare_cents is the tier fare before any coupon;
  -- discount_cents is the coupon discount; tip_cents is the rider's tip.
  category        TEXT NOT NULL DEFAULT 'economy',
  base_fare_cents INTEGER,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  promo_code      TEXT,
  tip_cents       INTEGER NOT NULL DEFAULT 0,
  -- A ride scheduled for later keeps status 'requested' but is hidden from the
  -- drivers' open list until this time arrives. NULL means "now".
  scheduled_for   TEXT,
  cancel_reason   TEXT,
  status         TEXT NOT NULL CHECK (status IN
                   ('requested', 'accepted', 'in_progress', 'completed', 'cancelled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Mutual ratings: after a ride is completed the rider rates the driver and the
-- driver rates the rider (1–5 stars + optional comment). One rating per rater
-- per ride.
CREATE TABLE IF NOT EXISTS ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id     INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (ride_id, rater_id)
);

-- In-ride chat between the rider and the assigned driver.
CREATE TABLE IF NOT EXISTS ride_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id     INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Promo codes (coupons): a percentage or fixed discount on the fare.
CREATE TABLE IF NOT EXISTS promos (
  code           TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value          INTEGER NOT NULL,            -- percent (1–100) or cents
  active         INTEGER NOT NULL DEFAULT 1,
  min_fare_cents INTEGER NOT NULL DEFAULT 0,  -- minimum fare to be eligible
  max_discount_cents INTEGER,                 -- cap for percent coupons (NULL = none)
  created_at     TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_id);
CREATE INDEX IF NOT EXISTS idx_messages_ride ON ride_messages(ride_id);
`;

// Idempotent column additions for databases created before these columns
// existed. SQLite's ALTER TABLE ADD COLUMN is a no-op-safe building block, but
// it errors if the column already exists, so each is guarded by a lookup.
const RIDE_COLUMNS = [
  ['category', "TEXT NOT NULL DEFAULT 'economy'"],
  ['base_fare_cents', 'INTEGER'],
  ['discount_cents', 'INTEGER NOT NULL DEFAULT 0'],
  ['promo_code', 'TEXT'],
  ['tip_cents', 'INTEGER NOT NULL DEFAULT 0'],
  ['scheduled_for', 'TEXT'],
  ['cancel_reason', 'TEXT'],
];

function migrateColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(rides)').all().map((c) => c.name));
  for (const [name, ddl] of RIDE_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE rides ADD COLUMN ${name} ${ddl}`);
  }
  // Backfill base_fare_cents for rows that predate it: the fare before discount.
  db.exec('UPDATE rides SET base_fare_cents = fare_cents + discount_cents WHERE base_fare_cents IS NULL');
}

// A couple of demo coupons so the promo tool works out of the box. INSERT OR
// IGNORE keeps it idempotent and never overwrites a code an operator changed.
const SEED_PROMOS = `
INSERT OR IGNORE INTO promos (code, kind, value, active, min_fare_cents, max_discount_cents, created_at) VALUES
  ('BEMVINDO10', 'percent', 10, 1, 0, 1500, '1970-01-01T00:00:00.000Z'),
  ('URBANO5',    'fixed',   500, 1, 1000, NULL, '1970-01-01T00:00:00.000Z');
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
  migrateColumns(db);
  db.exec(SEED_PROMOS);

  const hasCharges = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'charges'")
    .get();
  if (hasCharges) db.exec(BACKFILL_CHARGES);

  return db;
}
