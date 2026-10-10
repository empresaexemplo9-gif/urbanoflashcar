// Verifies the one-time backfill: a database created by a previous release
// (with a `charges` table) gets its charges copied into `payments` on open,
// so no completed ride is lost from the payment workflow after the upgrade.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db.js';
import { createUsersRepo } from '../src/repositories/users.js';
import { createRidesRepo } from '../src/repositories/rides.js';

test('charges from a previous release are backfilled into payments', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ufc-mig-')), 'legacy.db');
  const ts = new Date().toISOString();

  // Simulate an upgraded DB: current schema plus a legacy `charges` table
  // holding a paid and a failed charge for two completed rides.
  let db = openDatabase(file);
  const users = createUsersRepo(db);
  const rides = createRidesRepo(db);
  const rider = users.create({ email: 'leg@ex.com', name: 'Leg', role: 'rider', password: 'x', createdAt: ts });

  const mkRide = () =>
    rides.create({
      riderId: rider.id, pickupLabel: 'A', pickupLat: 0, pickupLng: 0,
      dropoffLabel: 'B', dropoffLat: 0, dropoffLng: 1, distanceKm: 1, durationMin: 2,
      fareCents: 1500, status: 'completed', createdAt: ts, updatedAt: ts,
    });
  const paidRide = mkRide();
  const failedRide = mkRide();

  db.exec(`CREATE TABLE charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER, rider_id INTEGER,
    amount_cents INTEGER, status TEXT, created_at TEXT, updated_at TEXT)`);
  const insC = db.prepare('INSERT INTO charges (ride_id, rider_id, amount_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  insC.run(paidRide.id, rider.id, 1500, 'paid', ts, ts);
  insC.run(failedRide.id, rider.id, 1500, 'failed', ts, ts);
  db.close();

  // Reopen: the backfill should run because `charges` now exists.
  db = openDatabase(file);
  const paid = db.prepare('SELECT * FROM payments WHERE ride_id = ?').get(paidRide.id);
  const failed = db.prepare('SELECT * FROM payments WHERE ride_id = ?').get(failedRide.id);
  assert.ok(paid, 'paid charge backfilled');
  assert.equal(paid.status, 'received');
  assert.equal(paid.amount_cents, 1500);
  assert.equal(failed.status, 'pending', 'unresolved charge becomes pending');

  // Idempotent: opening again does not duplicate.
  db.close();
  db = openDatabase(file);
  const count = db.prepare('SELECT COUNT(*) AS n FROM payments').get();
  assert.equal(count.n, 2);
  db.close();
});

test('new ride columns and seed promos are present and idempotent on reopen', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ufc-mig2-')), 'app.db');
  let db = openDatabase(file);
  const cols = new Set(db.prepare('PRAGMA table_info(rides)').all().map((c) => c.name));
  for (const c of ['category', 'base_fare_cents', 'discount_cents', 'promo_code', 'tip_cents', 'scheduled_for', 'cancel_reason']) {
    assert.ok(cols.has(c), `rides.${c} exists`);
  }
  const promos1 = db.prepare('SELECT COUNT(*) AS n FROM promos').get().n;
  assert.ok(promos1 >= 2, 'demo coupons seeded');
  db.close();

  // Reopening must not duplicate the seeded coupons.
  db = openDatabase(file);
  const promos2 = db.prepare('SELECT COUNT(*) AS n FROM promos').get().n;
  assert.equal(promos2, promos1);
  db.close();
});
