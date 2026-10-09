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
import { createPaymentsRepo } from './repositories/payments.js';
import { createAuthService } from './services/auth.js';
import { createRidesService } from './services/rides.js';
import { createPaymentsService } from './services/payments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function createApp(db, config, { now } = {}) {
  const users = createUsersRepo(db);
  const sessions = createSessionsRepo(db);
  const rides = createRidesRepo(db);
  const paymentsRepo = createPaymentsRepo(db);

  const auth = createAuthService({ users, sessions, config, now });
  const payments = createPaymentsService({ payments: paymentsRepo, rides, now });
  const rideService = createRidesService({ rides, config, payments, now });

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

  // Completing the ride opens a payment (pending) to settle with the driver.
  router.post('/api/rides/:id/complete', (ctx) => {
    const u = requireUser(ctx);
    return rideService.complete(u, parseId(ctx));
  });

  // --- Payments: direct to the driver, Pix or physical card (P004) ---
  router.get('/api/rides/:id/payment', (ctx) => {
    const u = requireUser(ctx);
    return { payment: payments.getForRide(u, parseId(ctx)) };
  });
  router.post('/api/rides/:id/payment/confirm', (ctx) => {
    const u = requireUser(ctx);
    const method = String((ctx.body || {}).method || '');
    return { payment: payments.confirm(u, parseId(ctx), method) };
  });

  router.serveStatic(PUBLIC_DIR);

  return router.handler();
}
