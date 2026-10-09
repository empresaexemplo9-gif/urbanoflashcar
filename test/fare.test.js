// Unit tests for the deterministic fare/geo logic (no server, no DB).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm } from '../src/lib/geo.js';
import { estimateTrip } from '../src/lib/fare.js';

const FARE = { baseCents: 250, perKmCents: 180, perMinCents: 35, minimumCents: 600, avgSpeedKmh: 30 };

test('distance between identical points is zero', () => {
  assert.equal(distanceKm(-23.56, -46.65, -23.56, -46.65), 0);
});

test('haversine matches a known São Paulo distance (~3 km)', () => {
  // Av. Paulista -> Parque Ibirapuera is roughly 2.9 km in a straight line.
  const d = distanceKm(-23.5614, -46.6559, -23.5874, -46.6576);
  assert.ok(d > 2.5 && d < 3.5, `expected ~3km, got ${d}`);
});

test('estimateTrip is deterministic and applies the model', () => {
  const a = estimateTrip({ lat: -23.5614, lng: -46.6559 }, { lat: -23.5874, lng: -46.6576 }, FARE);
  const b = estimateTrip({ lat: -23.5614, lng: -46.6559 }, { lat: -23.5874, lng: -46.6576 }, FARE);
  assert.deepEqual(a, b);
  assert.ok(a.fareCents > FARE.minimumCents);
  assert.ok(a.distanceKm > 0 && a.durationMin > 0);
});

test('very short trips are charged at least the minimum fare', () => {
  const t = estimateTrip({ lat: 0, lng: 0 }, { lat: 0.0001, lng: 0.0001 }, FARE);
  assert.equal(t.fareCents, FARE.minimumCents);
});

test('duration follows distance and average speed', () => {
  const t = estimateTrip({ lat: 0, lng: 0 }, { lat: 0, lng: 0.5 }, FARE);
  const expectedMin = (t.distanceKm / FARE.avgSpeedKmh) * 60;
  assert.ok(Math.abs(t.durationMin - expectedMin) < 0.2);
});
