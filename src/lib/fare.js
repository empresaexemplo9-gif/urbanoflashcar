// Deterministic fare estimation. Given a trip's coordinates and the fare model,
// it returns distance, duration and price. Pure function => directly testable
// (P009: measurable, reproducible behaviour).

import { distanceKm } from './geo.js';

export function estimateTrip(pickup, dropoff, fareModel) {
  const distance = distanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  const durationMin = (distance / fareModel.avgSpeedKmh) * 60;

  const raw =
    fareModel.baseCents +
    distance * fareModel.perKmCents +
    durationMin * fareModel.perMinCents;

  const fareCents = Math.max(fareModel.minimumCents, Math.round(raw));

  return {
    distanceKm: round(distance, 3),
    durationMin: round(durationMin, 1),
    fareCents,
  };
}

function round(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
