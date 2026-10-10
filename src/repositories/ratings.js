// Ratings repository: mutual post-ride ratings and the aggregate score shown
// on a user's profile.

export function createRatingsRepo(db) {
  const columns = 'id, ride_id, rater_id, ratee_id, stars, comment, created_at';

  return {
    create(rating) {
      const info = db
        .prepare(
          `INSERT INTO ratings (ride_id, rater_id, ratee_id, stars, comment, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(rating.rideId, rating.raterId, rating.rateeId, rating.stars, rating.comment ?? null, rating.createdAt);
      return db.prepare(`SELECT ${columns} FROM ratings WHERE id = ?`).get(Number(info.lastInsertRowid));
    },

    // The rating this rater already left for this ride, if any (one per ride).
    findByRideAndRater(rideId, raterId) {
      return db.prepare(`SELECT ${columns} FROM ratings WHERE ride_id = ? AND rater_id = ?`).get(rideId, raterId) ?? null;
    },

    // Aggregate score received by a user: { avg, count }. avg is null when none.
    summaryForUser(userId) {
      const row = db
        .prepare('SELECT COUNT(*) AS count, AVG(stars) AS avg FROM ratings WHERE ratee_id = ?')
        .get(userId);
      return { count: row.count, avg: row.avg == null ? null : Math.round(row.avg * 100) / 100 };
    },
  };
}
