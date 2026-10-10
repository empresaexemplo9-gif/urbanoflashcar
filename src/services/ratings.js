// Ratings: after a ride is completed each party rates the other (1–5 stars +
// optional comment). One rating per rater per ride. The aggregate score is
// exposed on a user's profile and alongside nearby drivers.

import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { publicRating } from './serialize.js';

export function createRatingsService({ ratings, rides, now = () => new Date() }) {
  function rate(user, rideId, { stars, comment } = {}) {
    const ride = rides.findById(rideId);
    if (!ride) throw notFound('Corrida não encontrada.', 'ride_not_found');

    const isRider = ride.rider_id === user.id;
    const isDriver = ride.driver_id === user.id;
    if (!isRider && !isDriver) throw notFound('Corrida não encontrada.', 'ride_not_found');
    if (ride.status !== 'completed') {
      throw conflict('A avaliação é feita após concluir a corrida.', 'ride_not_completed');
    }
    // The counterpart being rated.
    const rateeId = isRider ? ride.driver_id : ride.rider_id;
    if (!rateeId) throw forbidden('Não há contraparte para avaliar.', 'no_counterpart');

    const n = Math.round(Number(stars));
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw badRequest('A nota deve ser de 1 a 5 estrelas.', 'invalid_stars');
    }
    if (ratings.findByRideAndRater(rideId, user.id)) {
      throw conflict('Você já avaliou esta corrida.', 'already_rated');
    }

    const row = ratings.create({
      rideId,
      raterId: user.id,
      rateeId,
      stars: n,
      comment: comment != null ? String(comment).trim().slice(0, 500) || null : null,
      createdAt: now().toISOString(),
    });
    return publicRating(row);
  }

  // The rating this user already gave for a ride (so the UI can hide the form).
  function mine(user, rideId) {
    const row = ratings.findByRideAndRater(rideId, user.id);
    return row ? publicRating(row) : null;
  }

  function summary(userId) {
    return ratings.summaryForUser(userId);
  }

  return { rate, mine, summary };
}
