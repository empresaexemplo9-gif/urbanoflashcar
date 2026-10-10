// Integration tests for the Uber/99-style in-app tools added on top of the
// core journey: ride categories, promo codes, tipping, mutual ratings,
// scheduled rides, itemised receipts, in-ride chat and cancellation reasons.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { categoryFareCents, discountCents } from '../src/lib/pricing.js';

const PAULISTA = { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 };
const IBIRA = { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 };

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

let n = 0;
const rider = () => { n += 1; return srv.registerAndLogin({ name: `R${n}`, email: `fr${n}@ex.com`, password: 'supersenha1', role: 'rider' }); };
const driver = () => { n += 1; return srv.registerAndLogin({ name: `D${n}`, email: `fd${n}@ex.com`, password: 'supersenha1', role: 'driver' }); };

// Drive a ride all the way to completed, returning ids + tokens.
async function completedRide(body = { pickup: PAULISTA, dropoff: IBIRA }) {
  const r = await rider();
  const d = await driver();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body });
  const id = created.body.ride.id;
  await srv.request('POST', `/api/rides/${id}/accept`, { token: d.token });
  await srv.request('POST', `/api/rides/${id}/start`, { token: d.token });
  await srv.request('POST', `/api/rides/${id}/complete`, { token: d.token });
  return { id, r, d, ride: created.body.ride };
}

// --- pure pricing ---------------------------------------------------------

test('pricing: category multiplier honours the fare floor; discount never exceeds fare', () => {
  assert.equal(categoryFareCents(1000, 1.3, 600), 1300);
  assert.equal(categoryFareCents(100, 1.0, 600), 600); // floor
  assert.equal(discountCents(1000, { kind: 'percent', value: 10, min_fare_cents: 0, max_discount_cents: null }), 100);
  assert.equal(discountCents(1000, { kind: 'percent', value: 10, min_fare_cents: 0, max_discount_cents: 50 }), 50); // cap
  assert.equal(discountCents(1000, { kind: 'fixed', value: 5000, min_fare_cents: 0 }), 1000); // not more than fare
  assert.equal(discountCents(500, { kind: 'fixed', value: 500, min_fare_cents: 1000 }), 0); // below minimum
});

// --- categories -----------------------------------------------------------

test('GET /api/categories lists the ride tiers', async () => {
  const res = await srv.request('GET', '/api/categories');
  assert.equal(res.status, 200);
  const ids = res.body.categories.map((c) => c.id);
  assert.deepEqual(ids, ['economy', 'comfort', 'xl']);
});

test('estimate returns one option per category; comfort costs more than economy', async () => {
  const res = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA } });
  assert.equal(res.status, 200);
  assert.equal(res.body.options.length, 3);
  const eco = res.body.options.find((o) => o.id === 'economy').fareCents;
  const comfort = res.body.options.find((o) => o.id === 'comfort').fareCents;
  assert.ok(comfort > eco, 'comfort should be pricier');
  // Default top-level fare is the economy fare (backward compatible).
  assert.equal(res.body.fareCents, eco);
});

test('requesting with a category stores it and its fare', async () => {
  const r = await rider();
  const est = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA, category: 'comfort' } });
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA, category: 'comfort' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.ride.category, 'comfort');
  assert.equal(created.body.ride.fareCents, est.body.fareCents);
});

test('an unknown category is rejected', async () => {
  const res = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA, category: 'rocket' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_category');
});

// --- promo codes ----------------------------------------------------------

test('a valid coupon discounts the fare', async () => {
  const plain = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA } });
  const withPromo = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA, promoCode: 'bemvindo10' } });
  assert.equal(withPromo.status, 200);
  assert.ok(withPromo.body.discountCents > 0);
  assert.equal(withPromo.body.promoCode, 'BEMVINDO10');
  assert.equal(withPromo.body.fareCents, plain.body.fareCents - withPromo.body.discountCents);
});

test('an unknown coupon is rejected', async () => {
  const res = await srv.request('POST', '/api/estimate', { body: { pickup: PAULISTA, dropoff: IBIRA, promoCode: 'NOPE999' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_promo');
});

// --- scheduled rides ------------------------------------------------------

test('a ride scheduled for the future is hidden from drivers until due', async () => {
  const r = await rider();
  const d = await driver();
  const future = new Date(Date.now() + 3600000).toISOString();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA, scheduledFor: future } });
  assert.equal(created.status, 201);
  assert.equal(created.body.ride.scheduledFor, future);
  const open = await srv.request('GET', '/api/rides/available', { token: d.token });
  assert.equal(open.body.rides.find((x) => x.id === created.body.ride.id), undefined);
});

test('a schedule in the past is rejected', async () => {
  const r = await rider();
  const past = new Date(Date.now() - 1000).toISOString();
  const res = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA, scheduledFor: past } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'schedule_in_past');
});

// --- tipping + receipt ----------------------------------------------------

test('rider tips the driver and the receipt totals fare + tip', async () => {
  const { id, r } = await completedRide();
  const tipped = await srv.request('POST', `/api/rides/${id}/tip`, { token: r.token, body: { tipCents: 300 } });
  assert.equal(tipped.status, 200);
  assert.equal(tipped.body.ride.tipCents, 300);
  const rc = await srv.request('GET', `/api/rides/${id}/receipt`, { token: r.token });
  assert.equal(rc.status, 200);
  assert.equal(rc.body.receipt.tipCents, 300);
  assert.equal(rc.body.receipt.totalCents, rc.body.receipt.fareCents + 300);
});

test('only the rider can tip, and only after completion', async () => {
  const { id, d } = await completedRide();
  const byDriver = await srv.request('POST', `/api/rides/${id}/tip`, { token: d.token, body: { tipCents: 300 } });
  assert.equal(byDriver.status, 403);

  const r = await rider();
  const open = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const early = await srv.request('POST', `/api/rides/${open.body.ride.id}/tip`, { token: r.token, body: { tipCents: 100 } });
  assert.equal(early.status, 409);
});

// --- ratings --------------------------------------------------------------

test('rider rates driver; the score shows on the driver profile; no double rating', async () => {
  const { id, r, d } = await completedRide();
  const rated = await srv.request('POST', `/api/rides/${id}/rate`, { token: r.token, body: { stars: 5, comment: 'Ótimo!' } });
  assert.equal(rated.status, 201);
  assert.equal(rated.body.rating.stars, 5);

  const me = await srv.request('GET', '/api/me', { token: d.token });
  assert.equal(me.body.rating.count, 1);
  assert.equal(me.body.rating.avg, 5);

  const again = await srv.request('POST', `/api/rides/${id}/rate`, { token: r.token, body: { stars: 4 } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'already_rated');
});

test('rating out of range is rejected and rating before completion is blocked', async () => {
  const { id, r } = await completedRide();
  const bad = await srv.request('POST', `/api/rides/${id}/rate`, { token: r.token, body: { stars: 9 } });
  assert.equal(bad.status, 400);

  const r2 = await rider();
  const open = await srv.request('POST', '/api/rides', { token: r2.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const early = await srv.request('POST', `/api/rides/${open.body.ride.id}/rate`, { token: r2.token, body: { stars: 5 } });
  assert.equal(early.status, 409);
});

// --- in-ride chat ---------------------------------------------------------

test('rider and assigned driver exchange messages; outsiders are blocked', async () => {
  const r = await rider();
  const d = await driver();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;

  // Before a driver accepts, there is no counterpart.
  const tooEarly = await srv.request('POST', `/api/rides/${id}/messages`, { token: r.token, body: { body: 'oi' } });
  assert.equal(tooEarly.status, 409);

  await srv.request('POST', `/api/rides/${id}/accept`, { token: d.token });
  const sent = await srv.request('POST', `/api/rides/${id}/messages`, { token: r.token, body: { body: 'Estou na esquina' } });
  assert.equal(sent.status, 201);
  const reply = await srv.request('POST', `/api/rides/${id}/messages`, { token: d.token, body: { body: 'Chego em 2 min' } });
  assert.equal(reply.status, 201);

  const thread = await srv.request('GET', `/api/rides/${id}/messages`, { token: r.token });
  assert.equal(thread.body.messages.length, 2);

  const outsider = await rider();
  const blocked = await srv.request('GET', `/api/rides/${id}/messages`, { token: outsider.token });
  assert.equal(blocked.status, 404);
});

// --- cancellation reason --------------------------------------------------

test('a cancellation can record a reason', async () => {
  const r = await rider();
  const created = await srv.request('POST', '/api/rides', { token: r.token, body: { pickup: PAULISTA, dropoff: IBIRA } });
  const id = created.body.ride.id;
  const cancelled = await srv.request('POST', `/api/rides/${id}/cancel`, { token: r.token, body: { reason: 'Mudei de ideia' } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.ride.status, 'cancelled');
  assert.equal(cancelled.body.ride.cancelReason, 'Mudei de ideia');
});
