// Composition root: wires repositories, services and routes onto a Router and
// returns a plain node:http request handler. Accepts an already-open database
// so tests can inject an in-memory one. This is the contract boundary between
// the HTTP interface and the rest of the app (P006).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router, json } from './lib/http.js';
import { unauthorized, badRequest } from './lib/errors.js';
import { createUsersRepo } from './repositories/users.js';
import { createSessionsRepo } from './repositories/sessions.js';
import { createRidesRepo } from './repositories/rides.js';
import { createChargesRepo } from './repositories/charges.js';
import { createAuthService } from './services/auth.js';
import { createRidesService } from './services/rides.js';
import { createBillingService } from './services/billing.js';
import { createDeterministicGateway } from './lib/paymentGateway.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function createApp(db, config, { now, gateway } = {}) {
  const users = createUsersRepo(db);
  const sessions = createSessionsRepo(db);
  const rides = createRidesRepo(db);
  const charges = createChargesRepo(db);

  const auth = createAuthService({ users, sessions, config, now });
  const billing = createBillingService({
    charges,
    rides,
    gateway: gateway ?? createDeterministicGateway(),
    now,
  });
  const rideService = createRidesService({ rides, config, billing, now });

  const router = new Router();

  // Requires a valid session; returns the authenticated user row.
  const requireUser = (ctx) => auth.authenticate(bearer(ctx.req));
  const parseId = (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Id inválido.', 'invalid_id');
    return id;
  };

  // --- Health (P010) ---
  router.get('/api/health', () => ({ status: 'ok', time: (now?.() ?? new Date()).toISOString() }));

  // --- Auth (P003) ---
  router.post('/api/auth/register', (ctx) => json(201, { user: auth.register(ctx.body || {}) }));
  router.post('/api/auth/login', (ctx) => auth.login(ctx.body || {}));
  router.post('/api/auth/logout', (ctx) => {
    auth.logout(bearer(ctx.req));
    return { ok: true };
  });
  router.get('/api/me', (ctx) => {
    const u = requireUser(ctx);
    return { user: { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at } };
  });

  // --- Fare estimate (public helper for the journey) ---
  router.post('/api/estimate', (ctx) => rideService.estimate(ctx.body || {}));

  // --- Rides (P002 / P005) ---
  router.post('/api/rides', (ctx) => {
    const u = requireUser(ctx);
    return json(201, { ride: rideService.request(u, ctx.body || {}) });
  });
  router.get('/api/rides', (ctx) => {
    const u = requireUser(ctx);
    return { rides: rideService.listForUser(u) };
  });
  router.get('/api/rides/available', (ctx) => {
    const u = requireUser(ctx);
    return { rides: rideService.listOpen(u) };
  });
  router.get('/api/rides/:id', (ctx) => {
    const u = requireUser(ctx);
    return { ride: rideService.get(u, parseId(ctx)) };
  });

  for (const action of ['accept', 'start', 'cancel']) {
    router.post(`/api/rides/:id/${action}`, (ctx) => {
      const u = requireUser(ctx);
      return { ride: rideService.transition(u, parseId(ctx), action) };
    });
  }

  // Completing settles the fare and returns both the ride and the charge.
  router.post('/api/rides/:id/complete', async (ctx) => {
    const u = requireUser(ctx);
    return rideService.complete(u, parseId(ctx));
  });

  // --- Billing / charges (P004) ---
  router.get('/api/rides/:id/charge', (ctx) => {
    const u = requireUser(ctx);
    return { charge: billing.getForRide(u, parseId(ctx)) };
  });
  router.post('/api/rides/:id/charge/retry', async (ctx) => {
    const u = requireUser(ctx);
    return { charge: await billing.retry(u, parseId(ctx)) };
  });

  router.serveStatic(PUBLIC_DIR);

  return router.handler();
}
