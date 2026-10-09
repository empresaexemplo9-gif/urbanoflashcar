// Ride business rules: estimation, request, listing (scoped per account),
// retrieval with access control, and the status lifecycle with guarded
// transitions. This is the heart of the main journey (P005) and the place
// where per-account isolation is enforced (P003).

import { estimateTrip } from '../lib/fare.js';
import { assertCoord } from '../lib/geo.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { publicRide } from './serialize.js';

// Allowed status transitions and who may perform them.
const TRANSITIONS = {
  accept: { from: ['requested'], to: 'accepted', actor: 'driver' },
  start: { from: ['accepted'], to: 'in_progress', actor: 'driver' },
  complete: { from: ['in_progress'], to: 'completed', actor: 'driver' },
  cancel: { from: ['requested', 'accepted'], to: 'cancelled', actor: 'either' },
};

function parsePlace(place, name) {
  if (!place || typeof place !== 'object') {
    throw badRequest(`Campo obrigatório ausente: ${name}.`, 'missing_place');
  }
  const label = String(place.label ?? '').trim();
  if (label.length < 2) throw badRequest(`Informe um local válido em ${name}.`, 'invalid_label');
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  assertCoord(name, lat, lng);
  return { label, lat, lng };
}

export function createRidesService({ rides, config, payments = null, now = () => new Date() }) {
  function estimate({ pickup, dropoff }) {
    const p = parsePlace(pickup, 'pickup');
    const d = parsePlace(dropoff, 'dropoff');
    const trip = estimateTrip(p, d, config.fare);
    if (trip.distanceKm === 0) {
      throw badRequest('Origem e destino não podem ser o mesmo ponto.', 'zero_distance');
    }
    return { pickup: p, dropoff: d, ...trip };
  }

  function request(user, { pickup, dropoff }) {
    if (user.role !== 'rider') {
      throw forbidden('Apenas passageiros podem solicitar corridas.', 'role_not_rider');
    }
    const est = estimate({ pickup, dropoff });
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
    return rides.listOpenForDrivers().map(publicRide);
  }

  // Access rule: only the rider who owns the ride, or the assigned driver, may
  // read it. Everyone else gets 404 (do not reveal existence).
  function get(user, id) {
    const row = rides.findById(id);
    if (!row) throw notFound('Corrida não encontrada.', 'ride_not_found');
    const isRider = row.rider_id === user.id;
    const isAssignedDriver = row.driver_id === user.id;
    if (!isRider && !isAssignedDriver) {
      throw notFound('Corrida não encontrada.', 'ride_not_found');
    }
    return publicRide(row);
  }

  function transition(user, id, action) {
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
    const updated =
      action === 'accept'
        ? rides.updateStatus(id, rule.to, ts, user.id)
        : rides.updateStatus(id, rule.to, ts);
    return publicRide(updated);
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
      if (existing.rider_id !== user.id && existing.driver_id !== user.id) {
        throw notFound('Corrida não encontrada.', 'ride_not_found');
      }
      rideRow = existing;
    } else {
      transition(user, id, 'complete'); // validates actor + status transition
      rideRow = rides.findById(id);
    }

    const ride = publicRide(rideRow);
    const payment = payments ? payments.settleRide(ride) : null;
    return { ride, payment };
  }

  return { estimate, request, listForUser, listOpen, get, transition, complete };
}
