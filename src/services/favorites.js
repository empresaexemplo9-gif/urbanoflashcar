// Favorite routes business rules. Per-account: a rider lists, creates and
// removes only their own favorites.

import { parsePlace } from '../lib/places.js';
import { badRequest, notFound } from '../lib/errors.js';
import { publicFavorite } from './serialize.js';

export function createFavoritesService({ favorites, now = () => new Date() }) {
  function list(user) {
    return favorites.listByUser(user.id).map(publicFavorite);
  }

  function create(user, { label, pickup, dropoff }) {
    label = String(label ?? '').trim();
    if (label.length < 2) throw badRequest('Dê um nome à rota favorita.', 'invalid_label');
    const p = parsePlace(pickup, 'pickup');
    const d = parsePlace(dropoff, 'dropoff');
    const row = favorites.create({
      userId: user.id,
      label,
      pickupLabel: p.label, pickupLat: p.lat, pickupLng: p.lng,
      dropoffLabel: d.label, dropoffLat: d.lat, dropoffLng: d.lng,
      createdAt: now().toISOString(),
    });
    return publicFavorite(row);
  }

  function remove(user, id) {
    const ok = favorites.remove(id, user.id);
    if (!ok) throw notFound('Rota favorita não encontrada.', 'favorite_not_found');
  }

  return { list, create, remove };
}
