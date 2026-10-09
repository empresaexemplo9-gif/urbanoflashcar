// Sessions repository: opaque session tokens are stored only as SHA-256
// hashes, so a database leak does not expose usable tokens.

export function createSessionsRepo(db) {
  return {
    create({ tokenHash, userId, expiresAt, createdAt }) {
      db.prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(tokenHash, userId, expiresAt, createdAt);
    },

    findValid(tokenHash, nowIso) {
      return (
        db
          .prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
          .get(tokenHash, nowIso) ?? null
      );
    },

    delete(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },

    deleteExpired(nowIso) {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
    },
  };
}
