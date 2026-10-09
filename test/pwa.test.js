// Verifies the PWA assets are served correctly so the app is installable:
// a valid web manifest, the service worker, and PNG icons with the right types.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

test('serves a valid web app manifest', async () => {
  const res = await fetch(`${srv.base}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.name, 'UrbanoFlashCar');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  // Installability needs 192 and 512 icons, plus a maskable one.
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('serves the service worker as JavaScript', async () => {
  const res = await fetch(`${srv.base}/sw.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const body = await res.text();
  assert.match(body, /addEventListener\('fetch'/);
  // The API must never be cached by the worker.
  assert.match(body, /\/api\//);
});

test('serves PNG icons with the image/png type', async () => {
  for (const name of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
    const res = await fetch(`${srv.base}/icons/${name}`);
    assert.equal(res.status, 200, `${name} should be served`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG signature.
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${name} is a PNG`);
  }
});

test('the index page links the manifest and PWA icons', async () => {
  const res = await fetch(`${srv.base}/`);
  const html = await res.text();
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /name="theme-color"/);
});
