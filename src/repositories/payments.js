// Payments repository: the only place that reads/writes the payments table.
// Payment is direct to the driver (Pix or physical card), so there is no
// gateway reference — just the amount, the chosen method and the status.

export function createPaymentsRepo(db) {
  const columns = `id, ride_id, rider_id, driver_id, amount_cents, method,
    status, created_at, updated_at`;

  return {
    create(payment) {
      const info = db
        .prepare(
          `INSERT INTO payments
             (ride_id, rider_id, amount_cents, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payment.rideId,
          payment.riderId,
          payment.amountCents,
          payment.status,
          payment.createdAt,
          payment.updatedAt,
        );
      return this.findById(Number(info.lastInsertRowid));
    },

    findById(id) {
      return db.prepare(`SELECT ${columns} FROM payments WHERE id = ?`).get(id) ?? null;
    },

    findByRide(rideId) {
      return db.prepare(`SELECT ${columns} FROM payments WHERE ride_id = ?`).get(rideId) ?? null;
    },

    markReceived(id, { method, driverId, updatedAt }) {
      db.prepare(
        `UPDATE payments SET status = 'received', method = ?, driver_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(method, driverId, updatedAt, id);
      return this.findById(id);
    },
  };
}
