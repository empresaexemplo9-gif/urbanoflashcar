// Driver presence repository: whether a driver is online and their last known
// location. Upserted when a driver shares their position.

export function createDriverStatusRepo(db) {
  return {
    upsert({ userId, available, lat, lng, updatedAt }) {
      db.prepare(
        `INSERT INTO driver_status (user_id, available, lat, lng, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           available = excluded.available,
           lat = excluded.lat,
           lng = excluded.lng,
           updated_at = excluded.updated_at`,
      ).run(userId, available ? 1 : 0, lat, lng, updatedAt);
      return this.find(userId);
    },

    find(userId) {
      return db.prepare('SELECT * FROM driver_status WHERE user_id = ?').get(userId) ?? null;
    },

    // Available drivers with a fresh, known location (joined with their name).
    listAvailableWithLocation(sinceIso) {
      return db
        .prepare(
          `SELECT s.user_id, s.lat, s.lng, s.updated_at, u.name
           FROM driver_status s
           JOIN users u ON u.id = s.user_id
           WHERE s.available = 1 AND s.lat IS NOT NULL AND s.lng IS NOT NULL
             AND s.updated_at >= ?`,
        )
        .all(sinceIso);
    },
  };
}
