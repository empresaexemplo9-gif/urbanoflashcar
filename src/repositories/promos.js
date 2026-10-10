// Promos repository: look up a coupon by code. Codes are stored and compared
// in upper case.

export function createPromosRepo(db) {
  const columns = 'code, kind, value, active, min_fare_cents, max_discount_cents, created_at';

  return {
    findActive(code) {
      const row = db
        .prepare(`SELECT ${columns} FROM promos WHERE code = ? AND active = 1`)
        .get(String(code || '').trim().toUpperCase());
      return row ?? null;
    },
  };
}
