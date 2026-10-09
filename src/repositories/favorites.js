// Favorites repository: the only place that reads/writes the favorites table.
// Queries are scoped by user_id so a rider only ever sees their own routes.

export function createFavoritesRepo(db) {
  const columns = `id, user_id, label, pickup_label, pickup_lat, pickup_lng,
    dropoff_label, dropoff_lat, dropoff_lng, created_at`;

  return {
    create(fav) {
      const info = db
        .prepare(
          `INSERT INTO favorites
             (user_id, label, pickup_label, pickup_lat, pickup_lng,
              dropoff_label, dropoff_lat, dropoff_lng, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          fav.userId, fav.label,
          fav.pickupLabel, fav.pickupLat, fav.pickupLng,
          fav.dropoffLabel, fav.dropoffLat, fav.dropoffLng,
          fav.createdAt,
        );
      return this.findById(Number(info.lastInsertRowid));
    },

    findById(id) {
      return db.prepare(`SELECT ${columns} FROM favorites WHERE id = ?`).get(id) ?? null;
    },

    listByUser(userId) {
      return db
        .prepare(`SELECT ${columns} FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
        .all(userId);
    },

    remove(id, userId) {
      // Scoped by user_id: a user can only delete their own favorite.
      const info = db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(id, userId);
      return info.changes > 0;
    },
  };
}
