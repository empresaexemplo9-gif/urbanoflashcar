// Tests for billing / resilient payment integration (P004): success,
// unavailability, timeout, retry recovery, idempotency (no double charge),
// failure tolerance (completion not rolled back) and access control.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { openDatabase } from '../src/db.js';
import { createUsersRepo } from '../src/repositories/users.js';
import { createRidesRepo } from '../src/repositories/rides.js';
import { createChargesRepo } from '../src/repositories/charges.js';
import { createBillingService } from '../src/services/billing.js';
import {
  createDeterministicGateway,
  GatewayUnavailableError,
  GatewayTimeoutError,
} from '../src/lib/paymentGateway.js';
import { config as baseConfig } from '../src/config.js';

const PAULISTA = { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 };
const IBIRA = { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 };

// A gateway that fails a given number of times, then succeeds.
function flakyGateway(failTimes, Err = GatewayTimeoutError) {
  let n = 0;
  return {
    async charge({ idempotencyKey }) {
      if (n++ < failTimes) throw new Err();
      return { ref: `pay_recovered_${idempotencyKey}` };
    },
  };
}
const alwaysDown = { async charge() { throw new GatewayUnavailableError(); } };

// ---- Direct service unit tests (fine control over the gateway) ----------

function setupBilling(gateway) {
  const db = openDatabase(':memory:');
  const users = createUsersRepo(db);
  const rides = createRidesRepo(db);
  const charges = createChargesRepo(db);
  const rider = users.create({
    email: 'u@ex.com', name: 'U', role: 'rider', password: 'x', createdAt: new Date().toISOString(),
  });
  const ride = rides.create({
    riderId: rider.id, pickupLabel: 'A', pickupLat: 0, pickupLng: 0,
    dropoffLabel: 'B', dropoffLat: 0, dropoffLng: 1, distanceKm: 1, durationMin: 2,
    fareCents: 1500, status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const billing = createBillingService({ charges, rides, gateway });
  return { db, billing, ride, rider };
}

test('settleRide charges successfully on a healthy gateway', async () => {
  const { db, billing, ride } = setupBilling(createDeterministicGateway());
  const charge = await billing.settleRide(ride);
  assert.equal(charge.status, 'paid');
  assert.equal(charge.amountCents, 1500);
  assert.equal(charge.attempts, 1);
  assert.ok(charge.gatewayRef);
  db.close();
});

test('settleRide is idempotent: a paid ride is not charged twice', async () => {
  const { db, billing, ride } = setupBilling(createDeterministicGateway());
  const first = await billing.settleRide(ride);
  const second = await billing.settleRide(ride);
  assert.equal(second.status, 'paid');
  assert.equal(second.attempts, 1, 'no extra attempt on an already-paid ride');
  assert.equal(second.gatewayRef, first.gatewayRef);
  db.close();
});

test('gateway unavailability is recorded as failed, not thrown, and is retryable', async () => {
  const { db, billing, ride } = setupBilling(alwaysDown);
  const charge = await billing.settleRide(ride);
  assert.equal(charge.status, 'failed');
  assert.equal(charge.attempts, 1);
  assert.ok(charge.lastError);
  db.close();
});

test('retry recovers after transient timeouts and preserves the same charge', async () => {
  const { db, billing, ride, rider } = setupBilling(flakyGateway(2));
  const first = await billing.settleRide(ride); // attempt 1 -> fails
  assert.equal(first.status, 'failed');
  const second = await billing.retry({ id: rider.id }, ride.id); // attempt 2 -> fails
  assert.equal(second.status, 'failed');
  assert.equal(second.attempts, 2);
  const third = await billing.retry({ id: rider.id }, ride.id); // attempt 3 -> succeeds
  assert.equal(third.status, 'paid');
  assert.equal(third.attempts, 3);
  db.close();
});

// ---- HTTP integration tests --------------------------------------------

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

let n = 0;
async function completedRide(server) {
  n += 1;
  const r = await server.registerAndLogin({ name: `R${n}`, email: `r${n}@ex.com`, password: 'supersenha1', role: 'rider' });
  const d = await server.registerAndLogin({ name: `D${n}`, email: `d${n}@ex.com`, password: 'supersenha1', role: 'driver' });
  const created = await server.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  await server.request('POST', `/api/rides/${id}/accept`, { token: d.token });
  await server.request('POST', `/api/rides/${id}/start`, { token: d.token });
  return { id, rider: r, driver: d };
}

test('completing a ride returns a paid charge (default gateway)', async () => {
  const { id, driver } = await completedRide(srv);
  const res = await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.ride.status, 'completed');
  assert.equal(res.body.charge.status, 'paid');
  assert.equal(res.body.charge.amountCents, res.body.ride.fareCents);

  const charge = await srv.request('GET', `/api/rides/${id}/charge`, { token: driver.token });
  assert.equal(charge.body.charge.status, 'paid');
});

test('the charge summary appears in the rider ride list', async () => {
  const { id, rider, driver } = await completedRide(srv);
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const list = await srv.request('GET', '/api/rides', { token: rider.token });
  const found = list.body.rides.find((x) => x.id === id);
  assert.equal(found.charge.status, 'paid');
});

test('retrying an already-paid charge is rejected with 409', async () => {
  const { id, rider, driver } = await completedRide(srv);
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const res = await srv.request('POST', `/api/rides/${id}/charge/retry`, { token: rider.token });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'already_paid');
});

test('another user cannot read or retry a charge', async () => {
  const { id, driver } = await completedRide(srv);
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const intruder = await srv.registerAndLogin({ name: 'Int', email: `int${n}@ex.com`, password: 'supersenha1', role: 'rider' });
  const get = await srv.request('GET', `/api/rides/${id}/charge`, { token: intruder.token });
  assert.equal(get.status, 404);
  const retry = await srv.request('POST', `/api/rides/${id}/charge/retry`, { token: intruder.token });
  assert.equal(retry.status, 404);
});

test('a failed charge is left retryable without rolling back completion', async () => {
  const down = await startTestServer({ gateway: alwaysDown });
  try {
    const { id, driver } = await completedRide(down);
    const res = await down.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
    assert.equal(res.body.ride.status, 'completed', 'ride still completes');
    assert.equal(res.body.charge.status, 'failed', 'charge recorded as failed');
    assert.equal(res.body.charge.attempts, 1);

    const retry = await down.request('POST', `/api/rides/${id}/charge/retry`, { token: driver.token });
    assert.equal(retry.body.charge.status, 'failed');
    assert.equal(retry.body.charge.attempts, 2, 'work preserved, attempt incremented');
  } finally {
    await down.close();
  }
});

test('a flaky gateway recovers over HTTP via retry', async () => {
  const flaky = await startTestServer({ gateway: flakyGateway(1) });
  try {
    const { id, driver } = await completedRide(flaky);
    const res = await flaky.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
    assert.equal(res.body.charge.status, 'failed');
    const retry = await flaky.request('POST', `/api/rides/${id}/charge/retry`, { token: driver.token });
    assert.equal(retry.body.charge.status, 'paid');
  } finally {
    await flaky.close();
  }
});
