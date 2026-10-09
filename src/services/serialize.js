// Translates internal DB rows (snake_case) into the API contract (camelCase).
// Keeping this explicit means the wire format is stable even if columns change.

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at };
}

export function publicRide(row) {
  if (!row) return null;
  return {
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
}
