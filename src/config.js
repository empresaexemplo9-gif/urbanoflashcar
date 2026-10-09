// Central configuration. Values come from the environment with safe defaults
// so the platform runs out of the box but is tunable for deployment (P010).

export const config = {
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
