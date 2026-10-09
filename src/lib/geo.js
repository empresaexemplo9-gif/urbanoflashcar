// Great-circle distance between two coordinates (Haversine formula).
// Deterministic and dependency-free so fare estimates are reproducible.

import { badRequest } from './errors.js';

const EARTH_RADIUS_KM = 6371;

export function assertCoord(name, lat, lng) {
  if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw badRequest(`Coordenada inválida: ${name}.lat`, 'invalid_coordinate');
  }
  if (typeof lng !== 'number' || Number.isNaN(lng) || lng < -180 || lng > 180) {
    throw badRequest(`Coordenada inválida: ${name}.lng`, 'invalid_coordinate');
  }
}

export function distanceKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}
