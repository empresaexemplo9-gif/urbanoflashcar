// Tests for driver presence + nearby partner search.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { openDatabase } from '../src/db.js';
import { createDriverStatusRepo } from '../src/repositories/driverStatus.js';
import { createDriversService } from '../src/services/drivers.js';
import { config as baseConfig } from '../src/config.js';

// Reference pickup (Av. Paulista) and points at known-ish distances.
const PICKUP = { lat: -23.5614, lng: -46.6559 };
const NEAR = { lat: -23.5635, lng: -46.6570 }; // ~0.25 km
const FAR = { lat: -23.9000, lng: -46.6559 }; // ~38 km (outside 10 km)

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

let n = 0;
async function driver(name) {
  n += 1;
  return srv.registerAndLogin({ name: name || `D${n}`, email: `nd${n}@ex.com`, password: 'supersenha1', role: 'driver' });
}
async function rider() {
  n += 1;
  return srv.registerAndLogin({ name: `R${n}`, email: `nr${n}@ex.com`, password: 'supersenha1', role: 'rider' });
}

test('a driver shares location and appears in a rider\'s nearby search', async () => {
  const d = await driver('Perto');
  const r = await rider();
  const loc = await srv.request('POST', '/api/driver/location', {
    token: d.token, body: { available: true, lat: NEAR.lat, lng: NEAR.lng },
  });
  assert.equal(loc.status, 200);
  assert.equal(loc.body.status.available, true);

  const near = await srv.request('GET', `/api/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}`, { token: r.token });
  assert.equal(near.status, 200);
  const found = near.body.drivers.find((x) => x.driverId === d.user.id);
  assert.ok(found, 'driver should be listed');
  assert.ok(found.distanceKm >= 0 && found.distanceKm < 1);
  assert.ok(typeof found.etaMin === 'number');
});

test('a non-driver cannot share location', async () => {
  const r = await rider();
  const res = await srv.request('POST', '/api/driver/location', {
    token: r.token, body: { available: true, lat: NEAR.lat, lng: NEAR.lng },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'role_not_driver');
});

test('drivers outside the radius and offline drivers are excluded', async () => {
  const far = await driver('Longe');
  const off = await driver('Offline');
  const r = await rider();
  await srv.request('POST', '/api/driver/location', { token: far.token, body: { available: true, lat: FAR.lat, lng: FAR.lng } });
  await srv.request('POST', '/api/driver/location', { token: off.token, body: { available: false, lat: NEAR.lat, lng: NEAR.lng } });

  const near = await srv.request('GET', `/api/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}`, { token: r.token });
  const ids = near.body.drivers.map((x) => x.driverId);
  assert.ok(!ids.includes(far.user.id), 'far driver excluded');
  assert.ok(!ids.includes(off.user.id), 'offline driver excluded');
});

test('nearby going offline removes the driver from results', async () => {
  const d = await driver('Sai');
  const r = await rider();
  await srv.request('POST', '/api/driver/location', { token: d.token, body: { available: true, lat: NEAR.lat, lng: NEAR.lng } });
  let near = await srv.request('GET', `/api/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}`, { token: r.token });
  assert.ok(near.body.drivers.some((x) => x.driverId === d.user.id));

  await srv.request('POST', '/api/driver/offline', { token: d.token });
  near = await srv.request('GET', `/api/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}`, { token: r.token });
  assert.ok(!near.body.drivers.some((x) => x.driverId === d.user.id));
});

test('nearby rejects invalid coordinates', async () => {
  const r = await rider();
  const res = await srv.request('GET', '/api/drivers/nearby?lat=999&lng=0', { token: r.token });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_coordinate');
});

// Staleness depends on time, so exercise it at the service level with a
// controllable clock.
test('stale driver locations are not returned', () => {
  const db = openDatabase(':memory:');
  // Seed a driver user + a status updated 10 minutes ago.
  db.prepare("INSERT INTO users (email, name, role, password, created_at) VALUES ('s@ex.com','S','driver','x', ?)")
    .run(new Date().toISOString());
  const driverId = Number(db.prepare('SELECT id FROM users').get().id);
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO driver_status (user_id, available, lat, lng, updated_at) VALUES (?, 1, ?, ?, ?)')
    .run(driverId, NEAR.lat, NEAR.lng, tenMinAgo);

  const svc = createDriversService({
    driverStatus: createDriverStatusRepo(db),
    config: baseConfig, // freshness 5 min
    now: () => new Date(),
  });
  const rider = { id: 999, role: 'rider' };
  const fresh = svc.nearby(rider, { lat: PICKUP.lat, lng: PICKUP.lng });
  assert.equal(fresh.length, 0, 'a 10-min-old location is stale');
  db.close();
});
