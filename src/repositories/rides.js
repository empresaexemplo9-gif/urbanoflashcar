// Rides repository: all ride persistence. Queries are always scoped by an
// owner/driver id where relevant so isolation is enforced at the data layer
// too (defence in depth for P003).

export function createRidesRepo(db) {
  const columns = `id, rider_id, driver_id, pickup_label, pickup_lat, pickup_lng,
    dropoff_label, dropoff_lat, dropoff_lng, distance_km, duration_min,
    fare_cents, category, base_fare_cents, discount_cents, promo_code, tip_cents,
    scheduled_for, cancel_reason, status, created_at, updated_at`;

  // Same columns prefixed with the rides alias, plus a compact payment summary,
  // for the list queries that join the payments table.
  const listColumns = `r.id, r.rider_id, r.driver_id, r.pickup_label, r.pickup_lat,
    r.pickup_lng, r.dropoff_label, r.dropoff_lat, r.dropoff_lng, r.distance_km,
    r.duration_min, r.fare_cents, r.category, r.base_fare_cents, r.discount_cents,
    r.promo_code, r.tip_cents, r.scheduled_for, r.cancel_reason, r.status,
    r.created_at, r.updated_at, p.status AS payment_status, p.method AS payment_method`;

  return {
    create(ride) {
      const info = db
        .prepare(
          `INSERT INTO rides
             (rider_id, pickup_label, pickup_lat, pickup_lng,
              dropoff_label, dropoff_lat, dropoff_lng,
              distance_km, duration_min, fare_cents, category, base_fare_cents,
              discount_cents, promo_code, scheduled_for, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          ride.category ?? 'economy',
          ride.baseFareCents ?? ride.fareCents,
          ride.discountCents ?? 0,
          ride.promoCode ?? null,
          ride.scheduledFor ?? null,
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
          `SELECT ${listColumns} FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
           WHERE r.rider_id = ? ORDER BY r.created_at DESC, r.id DESC`,
        )
        .all(riderId);
    },

    // Open rides a driver may accept. Rides scheduled for the future are hidden
    // until their time arrives (nowIso); immediate rides have scheduled_for NULL.
    listOpenForDrivers(nowIso) {
      return db
        .prepare(
          `SELECT ${columns} FROM rides
           WHERE status = 'requested' AND (scheduled_for IS NULL OR scheduled_for <= ?)
           ORDER BY created_at ASC, id ASC`,
        )
        .all(nowIso);
    },

    listAssignedToDriver(driverId) {
      return db
        .prepare(
          `SELECT ${listColumns} FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
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

    setCancelReason(id, reason, updatedAt) {
      db.prepare('UPDATE rides SET cancel_reason = ?, updated_at = ? WHERE id = ?').run(reason, updatedAt, id);
      return this.findById(id);
    },

    setTip(id, tipCents, updatedAt) {
      db.prepare('UPDATE rides SET tip_cents = ?, updated_at = ? WHERE id = ?').run(tipCents, updatedAt, id);
      return this.findById(id);
    },
  };
}
