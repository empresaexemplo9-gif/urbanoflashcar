// Shared validation for a location {label, lat, lng}. Used by the ride and
// favorites services so the rules stay in one place.

import { assertCoord } from './geo.js';
import { badRequest } from './errors.js';

export function parsePlace(place, name) {
  if (!place || typeof place !== 'object') {
    throw badRequest(`Campo obrigatório ausente: ${name}.`, 'missing_place');
  }
  const label = String(place.label ?? '').trim();
  if (label.length < 2) throw badRequest(`Informe um local válido em ${name}.`, 'invalid_label');
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  assertCoord(name, lat, lng);
  return { label, lat, lng };
}
