// Driver presence + "nearby partner drivers" search.
//
//  - A driver shares their location and online flag (setLocation).
//  - A rider searches for the nearest available drivers to a pickup, within a
//    radius, considering only fresh locations (updated recently).

import { distanceKm, assertCoord } from '../lib/geo.js';
import { forbidden } from '../lib/errors.js';

export function createDriversService({ driverStatus, config, now = () => new Date() }) {
  function setLocation(user, { available, lat, lng }) {
    if (user.role !== 'driver') {
      throw forbidden('Apenas motoristas compartilham localização.', 'role_not_driver');
    }
    lat = Number(lat);
    lng = Number(lng);
    assertCoord('location', lat, lng);
    const row = driverStatus.upsert({
      userId: user.id,
      available: available !== false, // default online when sharing
      lat,
      lng,
      updatedAt: now().toISOString(),
    });
    return {
      available: !!row.available,
      lat: row.lat,
      lng: row.lng,
      updatedAt: row.updated_at,
    };
  }

  function goOffline(user) {
    if (user.role !== 'driver') {
      throw forbidden('Apenas motoristas alteram disponibilidade.', 'role_not_driver');
    }
    const existing = driverStatus.find(user.id);
    const row = driverStatus.upsert({
      userId: user.id,
      available: false,
      lat: existing?.lat ?? null,
      lng: existing?.lng ?? null,
      updatedAt: now().toISOString(),
    });
    return { available: !!row.available, updatedAt: row.updated_at };
  }

  function nearby(user, { lat, lng, radiusKm, limit }) {
    lat = Number(lat);
    lng = Number(lng);
    assertCoord('pickup', lat, lng);
    const radius = Number(radiusKm) > 0 ? Number(radiusKm) : config.nearbyRadiusKm;
    const max = Number(limit) > 0 ? Math.min(Number(limit), 20) : 5;

    const sinceIso = new Date(now().getTime() - config.driverFreshnessMs).toISOString();
    const avgSpeed = config.fare.avgSpeedKmh;

    return driverStatus
      .listAvailableWithLocation(sinceIso)
      .filter((d) => d.user_id !== user.id) // don't list yourself
      .map((d) => {
        const dist = distanceKm(lat, lng, d.lat, d.lng);
        return {
          driverId: d.user_id,
          name: d.name,
          distanceKm: round(dist, 2),
          etaMin: round((dist / avgSpeed) * 60, 0),
        };
      })
      .filter((d) => d.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, max);
  }

  return { setLocation, goOffline, nearby };
}

function round(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
