// Pure pricing helpers layered on top of the base fare: ride-category tiers
// and promo-code discounts. Kept dependency-free and deterministic so the
// whole price breakdown is reproducible and directly testable (P009).

function round(value) {
  return Math.round(value);
}

// Apply a category multiplier to the base fare, honouring the fare floor.
export function categoryFareCents(baseFareCents, multiplier, minimumCents) {
  return Math.max(minimumCents, round(baseFareCents * multiplier));
}

// Discount (in cents) a promo yields on a given fare. Never exceeds the fare
// and never applies below the coupon's minimum. `promo` is a DB row
// { kind: 'percent'|'fixed', value, min_fare_cents, max_discount_cents }.
// Returns 0 when the coupon does not apply.
export function discountCents(fareCents, promo) {
  if (!promo) return 0;
  if (fareCents < (promo.min_fare_cents || 0)) return 0;
  let d = promo.kind === 'percent'
    ? round((fareCents * promo.value) / 100)
    : promo.value;
  if (promo.kind === 'percent' && promo.max_discount_cents != null) {
    d = Math.min(d, promo.max_discount_cents);
  }
  return Math.max(0, Math.min(d, fareCents)); // never more than the fare
}

// Resolve a category id to its config entry, defaulting to the first category.
export function resolveCategory(categories, id) {
  return categories.find((c) => c.id === id) || categories[0];
}
