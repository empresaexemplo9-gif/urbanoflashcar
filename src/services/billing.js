// Billing business rules (P004). Settles the fare of a completed ride through
// the (simulated) payment gateway with resilient semantics:
//
//  - Idempotent: one charge per ride; a paid ride is never charged again.
//  - Failure-tolerant: a gateway outage/timeout does NOT lose the charge; the
//    record is kept as "failed" and can be retried, preserving the work.
//  - Observable: the charge carries status + attempt count so the UI can show
//    the synchronization state.
//
// The gateway is injected so success, unavailability and timeout are all
// exercised the same way in tests.

import { notFound, conflict } from '../lib/errors.js';
import { publicCharge } from './serialize.js';

export function createBillingService({ charges, rides, gateway, now = () => new Date() }) {
  // Internal: ensure a charge row exists for the ride, then run one attempt.
  async function settleRide(ride) {
    const existing = charges.findByRide(ride.id);
    if (existing && existing.status === 'paid') return publicCharge(existing);

    const ts = now().toISOString();
    const charge =
      existing ??
      charges.create({
        rideId: ride.id,
        riderId: ride.riderId ?? ride.rider_id,
        amountCents: ride.fareCents ?? ride.fare_cents,
        status: 'pending',
        attempts: 0,
        idempotencyKey: `ride-${ride.id}`,
        createdAt: ts,
        updatedAt: ts,
      });

    return attempt(charge);
  }

  async function attempt(charge) {
    const attempts = charge.attempts + 1;
    const ts = now().toISOString();
    try {
      const { ref } = await gateway.charge({
        idempotencyKey: charge.idempotency_key,
        amountCents: charge.amount_cents,
      });
      return publicCharge(charges.markPaid(charge.id, { attempts, gatewayRef: ref, updatedAt: ts }));
    } catch (err) {
      // Expected gateway failures are recorded and left retryable; the ride
      // stays completed and no work is lost.
      return publicCharge(
        charges.markFailed(charge.id, { attempts, lastError: err.message, updatedAt: ts }),
      );
    }
  }

  // Access control shared by the read + retry endpoints.
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
    const charge = charges.findByRide(rideId);
    if (!charge) throw notFound('Cobrança não encontrada.', 'charge_not_found');
    return publicCharge(charge);
  }

  async function retry(user, rideId) {
    authorizedRideOr404(user, rideId);
    const charge = charges.findByRide(rideId);
    if (!charge) throw notFound('Cobrança não encontrada.', 'charge_not_found');
    if (charge.status === 'paid') {
      throw conflict('Cobrança já foi paga.', 'already_paid');
    }
    return attempt(charge);
  }

  return { settleRide, getForRide, retry };
}
