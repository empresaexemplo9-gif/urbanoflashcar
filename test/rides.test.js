// Integration tests for the ride journey (P002/P005) and isolation (P003):
// estimate, request, list, cancel, the driver lifecycle, invalid transitions,
// and cross-account access control.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

const PAULISTA = { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 };
const IBIRA = { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 };

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

// Fresh accounts per test via unique emails.
let n = 0;
async function rider() {
  n += 1;
  return srv.registerAndLogin({ name: `Rider ${n}`, email: `rider${n}@ex.com`, password: 'supersenha1', role: 'rider' });
}
async function driver() {
  n += 1;
  return srv.registerAndLogin({ name: `Driver ${n}`, email: `driver${n}@ex.com`, password: 'supersenha1', role: 'driver' });
}

test('estimate returns fare, distance and duration', async () => {
  const res = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA } });
  assert.equal(res.status, 200);
  assert.ok(res.body.fareCents > 0);
  assert.ok(res.body.distanceKm > 0);
});

test('estimate rejects identical origin and destination', async () => {
  const res = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: PAULISTA } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'zero_distance');
});

test('estimate rejects invalid coordinates', async () => {
  const res = await srv.request('POST', '/api/estimate', {
    body: { pickup: { label: 'Origem', lat: 200, lng: 0 }, dropoff: IBIRA },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_coordinate');
});

test('a rider can request and then list their ride', async () => {
  const { token } = await rider();
  const create = await srv.request('POST', '/api/rides', { token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  assert.equal(create.status, 201);
  assert.equal(create.body.ride.status, 'requested');
  assert.ok(create.body.ride.fareCents > 0);

  const list = await srv.request('GET', '/api/rides', { token });
  assert.equal(list.status, 200);
  assert.equal(list.body.rides.length, 1);
  assert.equal(list.body.rides[0].id, create.body.ride.id);
});

test('a driver cannot request a ride', async () => {
  const { token } = await driver();
  const res = await srv.request('POST', '/api/rides', { token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'role_not_rider');
});

test('isolation: a rider cannot see another rider\'s ride', async () => {
  const a = await rider();
  const b = await rider();
  const created = await srv.request('POST', '/api/rides', { token: a.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;

  // B does not see it in their list...
  const bList = await srv.request('GET', '/api/rides', { token: b.token });
  assert.equal(bList.body.rides.length, 0);

  // ...and cannot fetch it directly (404, not 403, to avoid leaking existence).
  const bGet = await srv.request('GET', `/api/rides/${id}`, { token: b.token });
  assert.equal(bGet.status, 404);

  // ...and cannot cancel it.
  const bCancel = await srv.request('POST', `/api/rides/${id}/cancel`, { token: b.token });
  assert.equal(bCancel.status, 404);

  // The owner still can.
  const aGet = await srv.request('GET', `/api/rides/${id}`, { token: a.token });
  assert.equal(aGet.status, 200);
});

test('full driver lifecycle: available -> accept -> start -> complete', async () => {
  const r = await rider();
  const d = await driver();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;

  const available = await srv.request('GET', '/api/rides/available', { token: d.token });
  assert.ok(available.body.rides.some((x) => x.id === id));

  const accept = await srv.request('POST', `/api/rides/${id}/accept`, { token: d.token });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.ride.status, 'accepted');
  assert.equal(accept.body.ride.driverId, d.user.id);

  const start = await srv.request('POST', `/api/rides/${id}/start`, { token: d.token });
  assert.equal(start.body.ride.status, 'in_progress');

  const complete = await srv.request('POST', `/api/rides/${id}/complete`, { token: d.token });
  assert.equal(complete.body.ride.status, 'completed');
});

test('a ride cannot be completed before it starts (invalid transition)', async () => {
  const r = await rider();
  const d = await driver();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  await srv.request('POST', `/api/rides/${id}/accept`, { token: d.token });

  const res = await srv.request('POST', `/api/rides/${id}/complete`, { token: d.token });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'invalid_transition');
});

test('only the assigned driver can advance a ride', async () => {
  const r = await rider();
  const d1 = await driver();
  const d2 = await driver();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  await srv.request('POST', `/api/rides/${id}/accept`, { token: d1.token });

  const res = await srv.request('POST', `/api/rides/${id}/start`, { token: d2.token });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'not_assigned_driver');
});

test('an accepted ride is no longer in the available pool', async () => {
  const r = await rider();
  const d = await driver();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  await srv.request('POST', `/api/rides/${id}/accept`, { token: d.token });

  const available = await srv.request('GET', '/api/rides/available', { token: d.token });
  assert.ok(!available.body.rides.some((x) => x.id === id));
});

test('a rider can cancel a requested ride', async () => {
  const r = await rider();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  const cancel = await srv.request('POST', `/api/rides/${id}/cancel`, { token: r.token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.ride.status, 'cancelled');

  // Cancelling again is an invalid transition.
  const again = await srv.request('POST', `/api/rides/${id}/cancel`, { token: r.token });
  assert.equal(again.status, 409);
});

test('requesting a ride requires authentication', async () => {
  const res = await srv.request('POST', '/api/rides', { body: { pickup: PAULISTA, dropoff: IBIRA } });
  assert.equal(res.status, 401);
});
