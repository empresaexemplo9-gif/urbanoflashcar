// Users repository: the only place that reads/writes the users table.

export function createUsersRepo(db) {
  return {
    create({ email, name, role, password, createdAt }) {
      const stmt = db.prepare(
        `INSERT INTO users (email, name, role, password, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const info = stmt.run(email, name, role, password, createdAt);
      return this.findById(Number(info.lastInsertRowid));
    },

    findById(id) {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
    },

    findByEmail(email) {
      return db.prepare('SELECT * FROM users WHERE email = ?').get(email) ?? null;
    },
  };
}
