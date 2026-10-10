// Ride business rules: estimation (with categories + coupons), request
// (immediate or scheduled), listing (scoped per account), retrieval with
// access control, the status lifecycle with guarded transitions, and tipping.
// This is the heart of the main journey (P005) and where per-account isolation
// is enforced (P003).

import { estimateTrip } from '../lib/fare.js';
import { categoryFareCents, discountCents, resolveCategory } from '../lib/pricing.js';
import { parsePlace } from '../lib/places.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { publicRide } from './serialize.js';

// Allowed status transitions and who may perform them.
const TRANSITIONS = {
  accept: { from: ['requested'], to: 'accepted', actor: 'driver' },
  start: { from: ['accepted'], to: 'in_progress', actor: 'driver' },
  complete: { from: ['in_progress'], to: 'completed', actor: 'driver' },
  cancel: { from: ['requested', 'accepted'], to: 'cancelled', actor: 'either' },
};

const MAX_SCHEDULE_DAYS = 30;

export function createRidesService({ rides, config, promos = null, payments = null, now = () => new Date() }) {
  // Full price breakdown for a trip, given a category and an optional coupon.
  // Returns the per-category options plus the selected category's final fare.
  function price({ pickup, dropoff, category, promoCode }) {
    const p = parsePlace(pickup, 'pickup');
    const d = parsePlace(dropoff, 'dropoff');
    const trip = estimateTrip(p, d, config.fare);
    if (trip.distanceKm === 0) {
      throw badRequest('Origem e destino não podem ser o mesmo ponto.', 'zero_distance');
    }

    const cat = resolveCategory(config.categories, category);
    if (category && cat.id !== category) {
      throw badRequest('Categoria de corrida inválida.', 'invalid_category');
    }

    const options = config.categories.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      seats: c.seats,
      multiplier: c.multiplier,
      fareCents: categoryFareCents(trip.fareCents, c.multiplier, config.fare.minimumCents),
    }));

    const baseFareCents = categoryFareCents(trip.fareCents, cat.multiplier, config.fare.minimumCents);

    // Coupon: a provided-but-unknown code is an error; a known code below its
    // minimum simply yields a zero discount.
    let discount = 0;
    let code = null;
    if (promoCode != null && String(promoCode).trim() !== '') {
      code = String(promoCode).trim().toUpperCase();
      const promo = promos ? promos.findActive(code) : null;
      if (!promo) throw badRequest('Cupom inválido ou expirado.', 'invalid_promo');
      discount = discountCents(baseFareCents, promo);
    }

    const fareCents = Math.max(0, baseFareCents - discount);
    return {
      pickup: p,
      dropoff: d,
      distanceKm: trip.distanceKm,
      durationMin: trip.durationMin,
      category: cat.id,
      options,
      baseFareCents,
      discountCents: discount,
      promoCode: discount > 0 ? code : null,
      fareCents,
    };
  }

  // Public estimate helper for the journey (no ride created).
  function estimate(body) {
    return price(body || {});
  }

  function parseSchedule(scheduledFor) {
    if (scheduledFor == null || scheduledFor === '') return null;
    const when = new Date(scheduledFor);
    if (Number.isNaN(when.getTime())) throw badRequest('Data de agendamento inválida.', 'invalid_schedule');
    const t = now().getTime();
    if (when.getTime() <= t) throw badRequest('O agendamento deve ser no futuro.', 'schedule_in_past');
    if (when.getTime() > t + MAX_SCHEDULE_DAYS * 86400000) {
      throw badRequest(`O agendamento deve ser em até ${MAX_SCHEDULE_DAYS} dias.`, 'schedule_too_far');
    }
    return when.toISOString();
  }

  function request(user, body) {
    if (user.role !== 'rider') {
      throw forbidden('Apenas passageiros podem solicitar corridas.', 'role_not_rider');
    }
    const b = body || {};
    const est = price(b);
    const scheduledFor = parseSchedule(b.scheduledFor);
    const ts = now().toISOString();
    const row = rides.create({
      riderId: user.id,
      pickupLabel: est.pickup.label,
      pickupLat: est.pickup.lat,
      pickupLng: est.pickup.lng,
      dropoffLabel: est.dropoff.label,
      dropoffLat: est.dropoff.lat,
      dropoffLng: est.dropoff.lng,
      distanceKm: est.distanceKm,
      durationMin: est.durationMin,
      fareCents: est.fareCents,
      category: est.category,
      baseFareCents: est.baseFareCents,
      discountCents: est.discountCents,
      promoCode: est.promoCode,
      scheduledFor,
      status: 'requested',
      createdAt: ts,
      updatedAt: ts,
    });
    return publicRide(row);
  }

  function listForUser(user) {
    const rows = user.role === 'driver'
      ? rides.listAssignedToDriver(user.id)
      : rides.listByRider(user.id);
    return rows.map(publicRide);
  }

  function listOpen(user) {
    if (user.role !== 'driver') {
      throw forbidden('Apenas motoristas veem corridas disponíveis.', 'role_not_driver');
    }
    return rides.listOpenForDrivers(now().toISOString()).map(publicRide);
  }

  // Access rule: only the rider who owns the ride, or the assigned driver, may
  // read it. Everyone else gets 404 (do not reveal existence).
  function get(user, id) {
    const row = rides.findById(id);
    if (!row) throw notFound('Corrida não encontrada.', 'ride_not_found');
    assertParticipant(row, user);
    return publicRide(row);
  }

  function assertParticipant(row, user) {
    if (row.rider_id !== user.id && row.driver_id !== user.id) {
      throw notFound('Corrida não encontrada.', 'ride_not_found');
    }
  }

  function transition(user, id, action, { reason } = {}) {
    const rule = TRANSITIONS[action];
    if (!rule) throw badRequest('Ação inválida.', 'invalid_action');

    const row = rides.findById(id);
    if (!row) throw notFound('Corrida não encontrada.', 'ride_not_found');

    const isRider = row.rider_id === user.id;
    const isAssignedDriver = row.driver_id === user.id;

    // Authorization per action.
    if (action === 'accept') {
      if (user.role !== 'driver') throw forbidden('Apenas motoristas aceitam corridas.', 'role_not_driver');
    } else if (rule.actor === 'driver') {
      if (!isAssignedDriver) throw forbidden('Apenas o motorista designado pode fazer isso.', 'not_assigned_driver');
    } else if (rule.actor === 'either') {
      if (!isRider && !isAssignedDriver) throw notFound('Corrida não encontrada.', 'ride_not_found');
    }

    if (!rule.from.includes(row.status)) {
      throw conflict(
        `Transição inválida: não é possível "${action}" uma corrida com status "${row.status}".`,
        'invalid_transition',
      );
    }

    const ts = now().toISOString();
    let updated =
      action === 'accept'
        ? rides.updateStatus(id, rule.to, ts, user.id)
        : rides.updateStatus(id, rule.to, ts);
    // Record an optional cancellation reason (why the trip was cancelled).
    if (action === 'cancel' && reason != null && String(reason).trim() !== '') {
      updated = rides.setCancelReason(id, String(reason).trim().slice(0, 300), ts);
    }
    return publicRide(updated);
  }

  // Rider adds (or updates) a tip for the driver on a completed ride.
  function tip(user, id, tipCents) {
    const row = rides.findById(id);
    if (!row) throw notFound('Corrida não encontrada.', 'ride_not_found');
    if (row.rider_id !== user.id) throw forbidden('Apenas o passageiro da corrida dá gorjeta.', 'not_rider');
    if (row.status !== 'completed') throw conflict('A gorjeta é dada após concluir a corrida.', 'ride_not_completed');
    const amount = Math.round(Number(tipCents));
    if (!Number.isFinite(amount) || amount < 0) throw badRequest('Gorjeta inválida.', 'invalid_tip');
    if (amount > config.maxTipCents) throw badRequest('Gorjeta acima do limite.', 'tip_too_large');
    return publicRide(rides.setTip(id, amount, now().toISOString()));
  }

  // Itemised receipt for a completed (or any) ride, for the rider or driver.
  function receipt(user, id) {
    const row = rides.findById(id);
    if (!row) throw notFound('Corrida não encontrada.', 'ride_not_found');
    assertParticipant(row, user);
    const tipCents = row.tip_cents || 0;
    return {
      rideId: row.id,
      category: row.category,
      distanceKm: row.distance_km,
      durationMin: row.duration_min,
      baseFareCents: row.base_fare_cents ?? row.fare_cents,
      discountCents: row.discount_cents || 0,
      promoCode: row.promo_code,
      fareCents: row.fare_cents,
      tipCents,
      totalCents: row.fare_cents + tipCents,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  // Completing a ride opens a payment to be settled directly with the driver
  // (Pix or physical card). The driver confirms receipt afterwards.
  //
  // Idempotent and self-healing: if the ride is already completed (e.g. a
  // previous attempt committed the status but failed before the payment was
  // created, or data migrated from an older release) a party to the ride can
  // call this again to (re)create the missing pending payment. settleRide is
  // itself idempotent, so an existing payment is returned unchanged.
  function complete(user, id) {
    const existing = rides.findById(id);
    if (!existing) throw notFound('Corrida não encontrada.', 'ride_not_found');

    let rideRow;
    if (existing.status === 'completed') {
      assertParticipant(existing, user);
      rideRow = existing;
    } else {
      transition(user, id, 'complete'); // validates actor + status transition
      rideRow = rides.findById(id);
    }

    const ride = publicRide(rideRow);
    const payment = payments ? payments.settleRide(ride) : null;
    return { ride, payment };
  }

  return { estimate, price, request, listForUser, listOpen, get, transition, tip, receipt, complete };
}
