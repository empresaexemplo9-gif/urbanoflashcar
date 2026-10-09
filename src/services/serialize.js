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
  // List queries LEFT JOIN the payment; expose a compact summary when present.
  if (row.payment_status !== undefined) {
    ride.payment = row.payment_status
      ? { status: row.payment_status, method: row.payment_method }
      : null;
  }
  return ride;
}

export function publicFavorite(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    pickup: { label: row.pickup_label, lat: row.pickup_lat, lng: row.pickup_lng },
    dropoff: { label: row.dropoff_label, lat: row.dropoff_lat, lng: row.dropoff_lng },
    createdAt: row.created_at,
  };
}

export function publicPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    rideId: row.ride_id,
    riderId: row.rider_id,
    driverId: row.driver_id,
    amountCents: row.amount_cents,
    method: row.method,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
