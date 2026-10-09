// Charges repository: the only place that reads/writes the charges table.

export function createChargesRepo(db) {
  const columns = `id, ride_id, rider_id, amount_cents, status, attempts,
    idempotency_key, gateway_ref, last_error, created_at, updated_at`;

  return {
    create(charge) {
      const info = db
        .prepare(
          `INSERT INTO charges
             (ride_id, rider_id, amount_cents, status, attempts, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          charge.rideId,
          charge.riderId,
          charge.amountCents,
          charge.status,
          charge.attempts ?? 0,
          charge.idempotencyKey,
          charge.createdAt,
          charge.updatedAt,
        );
      return this.findById(Number(info.lastInsertRowid));
    },

    findById(id) {
      return db.prepare(`SELECT ${columns} FROM charges WHERE id = ?`).get(id) ?? null;
    },

    findByRide(rideId) {
      return db.prepare(`SELECT ${columns} FROM charges WHERE ride_id = ?`).get(rideId) ?? null;
    },

    markPaid(id, { attempts, gatewayRef, updatedAt }) {
      db.prepare(
        `UPDATE charges SET status = 'paid', attempts = ?, gateway_ref = ?,
           last_error = NULL, updated_at = ? WHERE id = ?`,
      ).run(attempts, gatewayRef, updatedAt, id);
      return this.findById(id);
    },

    markFailed(id, { attempts, lastError, updatedAt }) {
      db.prepare(
        `UPDATE charges SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      ).run(attempts, lastError, updatedAt, id);
      return this.findById(id);
    },
  };
}
