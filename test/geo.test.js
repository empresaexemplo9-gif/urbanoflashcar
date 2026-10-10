// Tests for the real-location proxy: the keyless geocoding lib (with an
// injected fetch, so no network) and the same-origin /api/geo/* routes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { searchPlaces, reversePlace, locateByIp, lookupCep, isCep, normalizeCep } from '../src/lib/geocode.js';
import { clientIp } from '../src/services/geo.js';

const GEO = {
  photonUrl: 'https://photon.test',
  ipUrl: 'https://ip.test/{ip}',
  viaCepUrl: 'https://viacep.test/ws/{cep}/json/',
  timeoutMs: 1000,
};

// A fetch stub: maps a substring of the URL to a JSON payload (or an error).
function stubFetch(routes) {
  return async (url) => {
    for (const [needle, value] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        if (value instanceof Error) throw value;
        return { ok: true, json: async () => value };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const PHOTON_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-46.6559, -23.5614] },
  properties: { name: 'Av. Paulista', city: 'São Paulo', state: 'SP' },
};

// --- lib/geocode.js (pure, injected fetch) --------------------------------

test('searchPlaces normalises Photon features to {label,lat,lng}', async () => {
  const fetchImpl = stubFetch({ '/api?q=': { features: [PHOTON_FEATURE] } });
  const places = await searchPlaces('paulista', { ...GEO, fetchImpl });
  assert.equal(places.length, 1);
  assert.equal(places[0].lat, -23.5614);
  assert.equal(places[0].lng, -46.6559);
  assert.match(places[0].label, /Paulista/);
});

test('searchPlaces ignores queries shorter than 3 chars', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.deepEqual(await searchPlaces('ab', { ...GEO, fetchImpl }), []);
  assert.equal(called, false);
});

test('searchPlaces returns [] on upstream failure (never throws)', async () => {
  const fetchImpl = stubFetch({ '/api?q=': new Error('network down') });
  assert.deepEqual(await searchPlaces('paulista', { ...GEO, fetchImpl }), []);
});

test('searchPlaces biases by lat/lon when given', async () => {
  let seen = '';
  const fetchImpl = async (url) => { seen = String(url); return { ok: true, json: async () => ({ features: [PHOTON_FEATURE] }) }; };
  await searchPlaces('rua 3 setor oeste', { ...GEO, fetchImpl, lat: -16.68, lon: -49.26 });
  assert.match(seen, /lat=-16\.68/);
  assert.match(seen, /lon=-49\.26/);
});

test('normalizeCep / isCep accept 8 digits with or without a dash', () => {
  assert.equal(normalizeCep('74110-010'), '74110010');
  assert.equal(normalizeCep('74110010'), '74110010');
  assert.equal(normalizeCep('7411'), null);
  assert.equal(isCep('74110-010'), true);
  assert.equal(isCep('rua 3'), false);
});

test('lookupCep resolves a CEP to a located place (ViaCEP + geocode)', async () => {
  const fetchImpl = stubFetch({
    'viacep.test': { cep: '74110-010', logradouro: 'Rua 3', bairro: 'Setor Oeste', localidade: 'Goiânia', uf: 'GO' },
    '/api?q=': { features: [PHOTON_FEATURE] },
  });
  const places = await lookupCep('74110-010', { ...GEO, fetchImpl });
  assert.equal(places.length, 1);
  assert.equal(places[0].lat, -23.5614); // coordinate from the geocoder
  assert.match(places[0].label, /Rua 3/);
  assert.match(places[0].label, /Setor Oeste/);
  assert.match(places[0].label, /Goiânia - GO/);
  assert.match(places[0].label, /CEP 74110-010/);
});

test('lookupCep returns [] for an unknown CEP (ViaCEP erro)', async () => {
  const fetchImpl = stubFetch({ 'viacep.test': { erro: true } });
  assert.deepEqual(await lookupCep('00000-000', { ...GEO, fetchImpl }), []);
});

test('reversePlace falls back to the coordinate when nothing is found', async () => {
  const fetchImpl = stubFetch({ '/reverse': { features: [] } });
  const place = await reversePlace(-23.5614, -46.6559, { ...GEO, fetchImpl });
  assert.equal(place.label, '-23.56140, -46.65590');
});

test('locateByIp tolerates lat/lon spellings and builds a label', async () => {
  const fetchImpl = stubFetch({ 'ip.test': { latitude: -23.55, longitude: -46.63, city: 'São Paulo', region: 'SP', country: 'Brasil' } });
  const place = await locateByIp('8.8.8.8', { ...GEO, fetchImpl });
  assert.equal(place.approx, true);
  assert.equal(place.lat, -23.55);
  assert.equal(place.label, 'São Paulo, SP, Brasil');
});

test('locateByIp rejects a 0,0 (unknown) result', async () => {
  const fetchImpl = stubFetch({ 'ip.test': { latitude: 0, longitude: 0 } });
  assert.equal(await locateByIp('1.2.3.4', { ...GEO, fetchImpl }), null);
});

// --- clientIp extraction --------------------------------------------------

test('clientIp honours X-Forwarded-For and strips IPv6 mapping', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: {} }), '203.0.113.7');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:198.51.100.9' } }), '198.51.100.9');
});

// --- /api/geo/* routes (server with injected fetch) -----------------------

let srv;
before(async () => {
  const fetchImpl = stubFetch({
    'viacep.com.br': { cep: '74110-010', logradouro: 'Rua 3', bairro: 'Setor Oeste', localidade: 'Goiânia', uf: 'GO' },
    '/api?q=': { features: [PHOTON_FEATURE] },
    '/reverse': { features: [PHOTON_FEATURE] },
    'ipwho.is': { latitude: -23.55, longitude: -46.63, city: 'São Paulo', region: 'SP', country: 'Brasil' },
  });
  srv = await startTestServer({ appOptions: { fetchImpl } });
});
after(async () => { await srv.close(); });

test('GET /api/geo/search proxies autocomplete (no auth required)', async () => {
  const res = await srv.request('GET', '/api/geo/search?q=paulista');
  assert.equal(res.status, 200);
  assert.equal(res.body.places.length, 1);
  assert.match(res.body.places[0].label, /Paulista/);
});

test('GET /api/geo/search resolves a CEP to a located place', async () => {
  const res = await srv.request('GET', '/api/geo/search?q=74110-010');
  assert.equal(res.status, 200);
  assert.equal(res.body.places.length, 1);
  assert.match(res.body.places[0].label, /CEP 74110-010/);
  assert.equal(res.body.places[0].lat, -23.5614);
});

test('GET /api/geo/reverse returns a labelled place', async () => {
  const res = await srv.request('GET', '/api/geo/reverse?lat=-23.5614&lng=-46.6559');
  assert.equal(res.status, 200);
  assert.match(res.body.place.label, /Paulista/);
});

test('GET /api/geo/reverse without coordinates is a 400', async () => {
  const res = await srv.request('GET', '/api/geo/reverse');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'missing_coordinate');
});

test('GET /api/geo/ip resolves an approximate place from the request', async () => {
  const res = await srv.request('GET', '/api/geo/ip');
  assert.equal(res.status, 200);
  // Loopback caller → server asks the provider for its own IP view; the stub
  // answers with São Paulo.
  assert.ok(res.body.place);
  assert.equal(res.body.place.approx, true);
  assert.equal(res.body.place.lat, -23.55);
});

test('geo endpoints return empty when the proxy is disabled', async () => {
  const off = await startTestServer({ geo: { disabled: true }, appOptions: { fetchImpl: async () => { throw new Error('must not call'); } } });
  try {
    const s = await off.request('GET', '/api/geo/search?q=paulista');
    assert.deepEqual(s.body.places, []);
    const ip = await off.request('GET', '/api/geo/ip');
    assert.equal(ip.body.place, null);
  } finally {
    await off.close();
  }
});
