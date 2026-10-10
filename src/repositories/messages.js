// Ride messages repository: the in-ride chat between the rider and the
// assigned driver.

export function createMessagesRepo(db) {
  const columns = 'id, ride_id, sender_id, body, created_at';

  return {
    create(message) {
      const info = db
        .prepare('INSERT INTO ride_messages (ride_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)')
        .run(message.rideId, message.senderId, message.body, message.createdAt);
      return db.prepare(`SELECT ${columns} FROM ride_messages WHERE id = ?`).get(Number(info.lastInsertRowid));
    },

    listByRide(rideId) {
      return db
        .prepare(`SELECT ${columns} FROM ride_messages WHERE ride_id = ? ORDER BY created_at ASC, id ASC`)
        .all(rideId);
    },
  };
}
