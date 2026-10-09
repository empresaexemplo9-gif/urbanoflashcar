// Translates internal DB rows (snake_case) into the API contract (camelCase).
// Keeping this explicit means the wire format is stable even if columns change.

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at };
}

export function publicRide(row) {
  if (!row) return null;
  const ride = {
    id: row.id,
    riderId: row.rider_id,
    driverId: row.driver_id,
    pickup: { label: row.pickup_label, lat: row.pickup_lat, lng: row.pickup_lng },
    dropoff: { label: row.dropoff_label, lat: row.dropoff_lat, lng: row.dropoff_lng },
    distanceKm: row.distance_km,
    durationMin: row.duration_min,
    fareCents: row.fare_cents,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // List queries LEFT JOIN the charge; expose a compact summary when present.
  if (row.charge_status !== undefined) {
    ride.charge = row.charge_status
      ? { status: row.charge_status, amountCents: row.charge_amount_cents }
      : null;
  }
  return ride;
}

export function publicCharge(row) {
  if (!row) return null;
  return {
    id: row.id,
    rideId: row.ride_id,
    amountCents: row.amount_cents,
    status: row.status,
    attempts: row.attempts,
    gatewayRef: row.gateway_ref,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
