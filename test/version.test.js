// Verifies the auto-update plumbing: the platform exposes its version and the
// service worker is served with that version injected, so the installed apps
// (PWA + desktop) can stay in lockstep with the platform.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { config } from '../src/config.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

test('exposes the platform version from package.json', async () => {
  const res = await fetch(`${srv.base}/api/version`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.version, /^\d+\.\d+\.\d+/, 'semver-ish version');
  assert.equal(body.version, config.version, 'matches the single source of truth');
});

test('serves the service worker with the version injected (cache busts per release)', async () => {
  const res = await fetch(`${srv.base}/sw.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  // Never cached, so the browser always re-checks for a new worker.
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const body = await res.text();
  // The placeholder must have been replaced with the real version...
  assert.ok(!body.includes('__APP_VERSION__'), 'placeholder is substituted');
  // ...and the concrete version must appear, so the worker bytes change each
  // release and the cache name is version-scoped.
  assert.ok(body.includes(config.version), 'worker carries the version');
  assert.match(body, /ufc-shell-/, 'cache name is derived from the version');
});
