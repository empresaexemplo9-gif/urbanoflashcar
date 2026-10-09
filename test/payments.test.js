// Tests for direct-to-driver payment (Pix or physical card): a payment opens
// as pending on completion, the assigned driver confirms receipt with a method,
// idempotency, validation and access control.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

const PAULISTA = { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 };
const IBIRA = { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 };

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

let n = 0;
async function completedRide() {
  n += 1;
  const r = await srv.registerAndLogin({ name: `R${n}`, email: `pr${n}@ex.com`, password: 'supersenha1', role: 'rider' });
  const d = await srv.registerAndLogin({ name: `D${n}`, email: `pd${n}@ex.com`, password: 'supersenha1', role: 'driver' });
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  await srv.request('POST', `/api/rides/${id}/accept`, { token: d.token });
  await srv.request('POST', `/api/rides/${id}/start`, { token: d.token });
  return { id, rider: r, driver: d, fareCents: created.body.ride.fareCents };
}

test('completing a ride opens a pending payment (no method yet)', async () => {
  const { id, driver, fareCents } = await completedRide();
  const res = await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.ride.status, 'completed');
  assert.equal(res.body.payment.status, 'pending');
  assert.equal(res.body.payment.method, null);
  assert.equal(res.body.payment.amountCents, fareCents);
});

test('the assigned driver confirms receipt via Pix', async () => {
  const { id, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const res = await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: driver.token, body: { method: 'pix' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.payment.status, 'received');
  assert.equal(res.body.payment.method, 'pix');
  assert.equal(res.body.payment.driverId, driver.user.id);
});

test('receipt can be confirmed via physical card too', async () => {
  const { id, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const res = await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: driver.token, body: { method: 'card' } });
  assert.equal(res.body.payment.method, 'card');
  assert.equal(res.body.payment.status, 'received');
});

test('an invalid method is rejected', async () => {
  const { id, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const res = await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: driver.token, body: { method: 'bitcoin' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_method');
});

test('confirming an already-received payment is rejected', async () => {
  const { id, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: driver.token, body: { method: 'pix' } });
  const again = await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: driver.token, body: { method: 'pix' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'already_received');
});

test('a rider cannot confirm receipt (only the driver)', async () => {
  const { id, rider, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const res = await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: rider.token, body: { method: 'pix' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'not_assigned_driver');
});

test('the payment summary appears in the ride list', async () => {
  const { id, rider, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  await srv.request('POST', `/api/rides/${id}/payment/confirm`, { token: driver.token, body: { method: 'pix' } });
  const list = await srv.request('GET', '/api/rides', { token: rider.token });
  const found = list.body.rides.find((x) => x.id === id);
  assert.equal(found.payment.status, 'received');
  assert.equal(found.payment.method, 'pix');
});

test('another user cannot read the payment', async () => {
  const { id, driver } = await completedRide();
  await srv.request('POST', `/api/rides/${id}/complete`, { token: driver.token });
  const intruder = await srv.registerAndLogin({ name: 'Int', email: `pint${n}@ex.com`, password: 'supersenha1', role: 'rider' });
  const res = await srv.request('GET', `/api/rides/${id}/payment`, { token: intruder.token });
  assert.equal(res.status, 404);
});
