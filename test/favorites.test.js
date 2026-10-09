// Tests for favorite routes: per-account list/create/delete, validation,
// and isolation between accounts.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

const PAULISTA = { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 };
const IBIRA = { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 };

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

let n = 0;
async function rider() {
  n += 1;
  return srv.registerAndLogin({ name: `R${n}`, email: `fav${n}@ex.com`, password: 'supersenha1', role: 'rider' });
}

test('a rider creates and lists a favorite route', async () => {
  const { token } = await rider();
  const res = await srv.request('POST', '/api/favorites', {
    token, body: { label: 'Casa → Trabalho', pickup: PAULISTA, dropoff: IBIRA },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.favorite.label, 'Casa → Trabalho');
  assert.equal(res.body.favorite.pickup.label, PAULISTA.label);

  const list = await srv.request('GET', '/api/favorites', { token });
  assert.equal(list.body.favorites.length, 1);
  assert.equal(list.body.favorites[0].id, res.body.favorite.id);
});

test('favorite creation validates name and places', async () => {
  const { token } = await rider();
  const noName = await srv.request('POST', '/api/favorites', { token, body: { label: 'x', pickup: PAULISTA, dropoff: IBIRA } });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error.code, 'invalid_label');

  const noPickup = await srv.request('POST', '/api/favorites', { token, body: { label: 'Rota', dropoff: IBIRA } });
  assert.equal(noPickup.status, 400);
  assert.equal(noPickup.body.error.code, 'missing_place');
});

test('favorites are isolated per account', async () => {
  const a = await rider();
  const b = await rider();
  const created = await srv.request('POST', '/api/favorites', {
    token: a.token, body: { label: 'Rota A', pickup: PAULISTA, dropoff: IBIRA },
  });
  const id = created.body.favorite.id;

  const bList = await srv.request('GET', '/api/favorites', { token: b.token });
  assert.equal(bList.body.favorites.length, 0);

  const bDelete = await srv.request('DELETE', `/api/favorites/${id}`, { token: b.token });
  assert.equal(bDelete.status, 404);

  // Owner can delete; deleting again is 404.
  const del = await srv.request('DELETE', `/api/favorites/${id}`, { token: a.token });
  assert.equal(del.status, 200);
  const again = await srv.request('DELETE', `/api/favorites/${id}`, { token: a.token });
  assert.equal(again.status, 404);
});

test('favorites require authentication', async () => {
  const res = await srv.request('GET', '/api/favorites');
  assert.equal(res.status, 401);
});
