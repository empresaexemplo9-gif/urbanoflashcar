// Test harness: boots the real app against an in-memory database on an
// ephemeral port and returns a small fetch-based client. Each test file gets
// an isolated server + DB, so tests never share state.

import { createServer } from 'node:http';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { config as baseConfig } from '../src/config.js';

export async function startTestServer(overrides = {}) {
  const db = openDatabase(':memory:');
  const config = { ...baseConfig, ...overrides, fare: { ...baseConfig.fare, ...(overrides.fare || {}) } };
  const server = createServer(createApp(db, config));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(method, path, { token, body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: data };
  }

  async function registerAndLogin(user) {
    await request('POST', '/api/auth/register', { body: user });
    const res = await request('POST', '/api/auth/login', {
      body: { email: user.email, password: user.password },
    });
    return { token: res.body.token, user: res.body.user };
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { base, request, registerAndLogin, close, config };
}
