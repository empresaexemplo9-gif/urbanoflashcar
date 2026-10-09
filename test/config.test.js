// Verifies the public client-config endpoint that exposes the (publishable)
// Google Maps API key to the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

test('config endpoint returns an empty maps key when none is configured', async () => {
  // Pass '' explicitly so the test does not depend on GOOGLE_MAPS_API_KEY /
  // UFC_MAPS_API_KEY possibly being set in the execution environment.
  const srv = await startTestServer({ mapsApiKey: '' });
  try {
    const res = await srv.request('GET', '/api/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.mapsApiKey, '');
  } finally {
    await srv.close();
  }
});

test('config endpoint exposes the configured maps key', async () => {
  const srv = await startTestServer({ mapsApiKey: 'test-key-123' });
  try {
    const res = await srv.request('GET', '/api/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.mapsApiKey, 'test-key-123');
  } finally {
    await srv.close();
  }
});
