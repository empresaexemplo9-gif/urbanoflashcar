// Integration tests for accounts & access (P003): registration, validation,
// login, session use, logout, and protected routes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

test('health check responds ok', async () => {
  const res = await srv.request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('registration creates a user and hides the password', async () => {
  const res = await srv.request('POST', '/api/auth/register', {
    body: { name: 'Ana Rider', email: 'ana@example.com', password: 'supersenha1', role: 'rider' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'ana@example.com');
  assert.equal(res.body.user.role, 'rider');
  assert.equal(res.body.user.password, undefined);
});

test('registration rejects weak passwords and bad emails', async () => {
  const weak = await srv.request('POST', '/api/auth/register', {
    body: { name: 'X Y', email: 'weak@example.com', password: 'short', role: 'rider' },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error.code, 'weak_password');

  const bad = await srv.request('POST', '/api/auth/register', {
    body: { name: 'X Y', email: 'not-an-email', password: 'supersenha1', role: 'rider' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'invalid_email');
});

test('duplicate email is rejected with 409', async () => {
  const body = { name: 'Dup', email: 'dup@example.com', password: 'supersenha1', role: 'rider' };
  await srv.request('POST', '/api/auth/register', { body });
  const again = await srv.request('POST', '/api/auth/register', { body });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'email_taken');
});

test('login returns a token and /me resolves it', async () => {
  await srv.request('POST', '/api/auth/register', {
    body: { name: 'Bob', email: 'bob@example.com', password: 'supersenha1', role: 'driver' },
  });
  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'bob@example.com', password: 'supersenha1' },
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);

  const me = await srv.request('GET', '/api/me', { token: login.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'bob@example.com');
  assert.equal(me.body.user.role, 'driver');
});

test('wrong password is rejected', async () => {
  await srv.request('POST', '/api/auth/register', {
    body: { name: 'Cia', email: 'cia@example.com', password: 'supersenha1', role: 'rider' },
  });
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'cia@example.com', password: 'wrongpass1' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'invalid_credentials');
});

test('protected route without a token is 401', async () => {
  const res = await srv.request('GET', '/api/me');
  assert.equal(res.status, 401);
});

test('logout invalidates the session token', async () => {
  const { token } = await srv.registerAndLogin({
    name: 'Out', email: 'out@example.com', password: 'supersenha1', role: 'rider',
  });
  const okBefore = await srv.request('GET', '/api/me', { token });
  assert.equal(okBefore.status, 200);

  await srv.request('POST', '/api/auth/logout', { token });
  const after = await srv.request('GET', '/api/me', { token });
  assert.equal(after.status, 401);
  assert.equal(after.body.error.code, 'invalid_session');
});
