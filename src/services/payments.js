// Payment business rules. For now payment is settled DIRECTLY with the driver
// via Pix or a physical card machine — there is no online gateway.
//
//  - When a ride is completed a payment is created as "pending".
//  - The assigned driver confirms receipt, recording the method (pix | card);
//    the payment becomes "received".
//
// Idempotent: one payment per ride; confirming an already-received payment is
// rejected.

import { notFound, forbidden, conflict, badRequest } from '../lib/errors.js';
import { publicPayment } from './serialize.js';

const METHODS = new Set(['pix', 'card']);

export function createPaymentsService({ payments, rides, now = () => new Date() }) {
  // Called on ride completion: ensure a pending payment exists for the ride.
  function settleRide(ride) {
    const existing = payments.findByRide(ride.id);
    if (existing) return publicPayment(existing);

    const ts = now().toISOString();
    const row = payments.create({
      rideId: ride.id,
      riderId: ride.riderId ?? ride.rider_id,
      amountCents: ride.fareCents ?? ride.fare_cents,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    });
    return publicPayment(row);
  }

  function authorizedRideOr404(user, rideId) {
    const ride = rides.findById(rideId);
    if (!ride) throw notFound('Corrida não encontrada.', 'ride_not_found');
    if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
      throw notFound('Corrida não encontrada.', 'ride_not_found');
    }
    return ride;
  }

  function getForRide(user, rideId) {
    authorizedRideOr404(user, rideId);
    const payment = payments.findByRide(rideId);
    if (!payment) throw notFound('Pagamento não encontrado.', 'payment_not_found');
    return publicPayment(payment);
  }

  // The assigned driver confirms they received the payment (Pix or card).
  function confirm(user, rideId, method) {
    const ride = rides.findById(rideId);
    if (!ride) throw notFound('Corrida não encontrada.', 'ride_not_found');
    if (ride.driver_id !== user.id) {
      throw forbidden('Apenas o motorista da corrida confirma o recebimento.', 'not_assigned_driver');
    }
    if (!METHODS.has(method)) {
      throw badRequest('Método inválido (use pix ou card).', 'invalid_method');
    }

    const payment = payments.findByRide(rideId);
    if (!payment) throw notFound('Pagamento não encontrado.', 'payment_not_found');
    if (payment.status === 'received') {
      throw conflict('Pagamento já foi recebido.', 'already_received');
    }

    const updated = payments.markReceived(payment.id, {
      method,
      driverId: user.id,
      updatedAt: now().toISOString(),
    });
    return publicPayment(updated);
  }

  return { settleRide, getForRide, confirm };
}
