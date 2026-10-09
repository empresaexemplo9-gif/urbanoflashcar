// Rides repository: all ride persistence. Queries are always scoped by an
// owner/driver id where relevant so isolation is enforced at the data layer
// too (defence in depth for P003).

export function createRidesRepo(db) {
  const columns = `id, rider_id, driver_id, pickup_label, pickup_lat, pickup_lng,
    dropoff_label, dropoff_lat, dropoff_lng, distance_km, duration_min,
    fare_cents, status, created_at, updated_at`;

  // Same columns prefixed with the rides alias, plus a compact charge summary,
  // for the list queries that join the charges table.
  const listColumns = `r.id, r.rider_id, r.driver_id, r.pickup_label, r.pickup_lat,
    r.pickup_lng, r.dropoff_label, r.dropoff_lat, r.dropoff_lng, r.distance_km,
    r.duration_min, r.fare_cents, r.status, r.created_at, r.updated_at,
    c.status AS charge_status, c.amount_cents AS charge_amount_cents`;

  return {
    create(ride) {
      const info = db
        .prepare(
          `INSERT INTO rides
             (rider_id, pickup_label, pickup_lat, pickup_lng,
              dropoff_label, dropoff_lat, dropoff_lng,
              distance_km, duration_min, fare_cents, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ride.riderId,
          ride.pickupLabel,
          ride.pickupLat,
          ride.pickupLng,
          ride.dropoffLabel,
          ride.dropoffLat,
          ride.dropoffLng,
          ride.distanceKm,
          ride.durationMin,
          ride.fareCents,
          ride.status,
          ride.createdAt,
          ride.updatedAt,
        );
      return this.findById(Number(info.lastInsertRowid));
    },

    findById(id) {
      return db.prepare(`SELECT ${columns} FROM rides WHERE id = ?`).get(id) ?? null;
    },

    listByRider(riderId) {
      return db
        .prepare(
          `SELECT ${listColumns} FROM rides r LEFT JOIN charges c ON c.ride_id = r.id
           WHERE r.rider_id = ? ORDER BY r.created_at DESC, r.id DESC`,
        )
        .all(riderId);
    },

    listOpenForDrivers() {
      return db
        .prepare(`SELECT ${columns} FROM rides WHERE status = 'requested' ORDER BY created_at ASC, id ASC`)
        .all();
    },

    listAssignedToDriver(driverId) {
      return db
        .prepare(
          `SELECT ${listColumns} FROM rides r LEFT JOIN charges c ON c.ride_id = r.id
           WHERE r.driver_id = ? ORDER BY r.created_at DESC, r.id DESC`,
        )
        .all(driverId);
    },

    updateStatus(id, status, updatedAt, driverId = undefined) {
      if (driverId === undefined) {
        db.prepare('UPDATE rides SET status = ?, updated_at = ? WHERE id = ?').run(
          status,
          updatedAt,
          id,
        );
      } else {
        db.prepare(
          'UPDATE rides SET status = ?, driver_id = ?, updated_at = ? WHERE id = ?',
        ).run(status, driverId, updatedAt, id);
      }
      return this.findById(id);
    },
  };
}
