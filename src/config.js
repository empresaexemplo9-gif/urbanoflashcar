// Central configuration. Values come from the environment with safe defaults
// so the platform runs out of the box but is tunable for deployment (P010).

import { readFileSync } from 'node:fs';

// Single source of truth for the platform version: package.json. The web
// shell, the service worker and the desktop app all report this same value so
// the installed apps stay in lockstep with the platform (auto-update).
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const config = {
  version: readVersion(),
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',

  // Where the SQLite file lives. ":memory:" is used by the test suite.
  databaseFile: process.env.DATABASE_FILE || 'data/urbanoflashcar.db',

  // Session lifetime in milliseconds (default 7 days).
  sessionTtlMs: Number(process.env.SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000,

  // How recent a driver's shared location must be to count as "online" when
  // searching for nearby partners (default 5 minutes), and the default search
  // radius in km.
  driverFreshnessMs: Number(process.env.DRIVER_FRESHNESS_MS) || 5 * 60 * 1000,
  nearbyRadiusKm: Number(process.env.NEARBY_RADIUS_KM) || 10,

  // Real-location services, proxied through our own origin (see
  // src/services/geo.js). Keeping them server-side means the browser only ever
  // talks to this app: ad-blockers / tracking-protection can't block a
  // same-origin request, there is no CORS, and the IP fallback uses the real
  // client IP seen by the server. All keyless and OSM-based; swap the URLs for
  // a self-hosted Photon/Nominatim + IP provider in production at scale.
  geo: {
    // Photon (OSM) for address autocomplete + reverse geocoding. No API key.
    photonUrl: process.env.GEO_PHOTON_URL || 'https://photon.komoot.io',
    // Keyless IP geolocation. "{ip}" is replaced with the client IP; a bare
    // base (no placeholder) resolves the caller's own IP. ipwho.is is CORS/
    // key-free and returns { latitude, longitude, city, region, country }.
    ipUrl: process.env.GEO_IP_URL || 'https://ipwho.is/{ip}',
    // Max time to wait on an upstream geo call before giving up (ms).
    timeoutMs: Number(process.env.GEO_TIMEOUT_MS) || 6000,
    // Set GEO_DISABLED=1 to turn the proxy off entirely (endpoints then return
    // empty results and the UI falls back to manual presets/coordinates).
    disabled: process.env.GEO_DISABLED === '1',
  },

  // Deterministic fare model (cents of R$). Tunable, but fixed per request so
  // estimates are reproducible and testable (P009).
  fare: {
    baseCents: Number(process.env.FARE_BASE_CENTS) || 250,
    perKmCents: Number(process.env.FARE_PER_KM_CENTS) || 180,
    perMinCents: Number(process.env.FARE_PER_MIN_CENTS) || 35,
    minimumCents: Number(process.env.FARE_MINIMUM_CENTS) || 600,
    avgSpeedKmh: Number(process.env.FARE_AVG_SPEED_KMH) || 30,
  },
};
