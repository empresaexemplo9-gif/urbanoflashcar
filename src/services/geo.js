// Real-location service: a thin, same-origin proxy over keyless OSM/IP
// services. The UI calls these instead of third-party hosts directly, so the
// browser only ever talks to this app (immune to ad-blockers/CORS) and the IP
// fallback uses the real client IP the server sees.

import { searchPlaces, reversePlace, locateByIp, lookupCep, isCep } from '../lib/geocode.js';

// Private/loopback ranges never geolocate — skip the upstream call and let the
// provider resolve the caller's own IP (or return nothing) instead.
function isPublicIp(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.')) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (ip.startsWith('169.254.') || ip === '0.0.0.0') return false;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return false;
  return true;
}

// Best-effort client IP: honour the first X-Forwarded-For hop (set by a trusted
// reverse proxy / load balancer), then X-Real-IP, then the socket peer. IPv6
// "::ffff:" mapping is stripped so the IP provider gets a plain IPv4.
export function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : (xff || '').split(',')[0];
  const real = req.headers?.['x-real-ip'];
  const sock = req.socket?.remoteAddress || '';
  const raw = String(first || real || sock || '').trim();
  return raw.replace(/^::ffff:/, '');
}

export function createGeoService({ config, fetchImpl = globalThis.fetch }) {
  const { photonUrl, viaCepUrl, ipUrl, timeoutMs, disabled } = config.geo;
  const opts = { photonUrl, fetchImpl, timeoutMs };

  // Address search. A CEP (postal code) is resolved via ViaCEP; otherwise the
  // query is a street + sector/neighbourhood, biased to the rider's position
  // (lat/lng) so the right city wins. `bias` is optional { lat, lng }.
  async function search(query, bias = {}) {
    if (disabled) return [];
    // Query params arrive as strings; '' / null / non-numeric mean "no bias".
    const num = (v) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? undefined : n; };
    const lat = num(bias.lat);
    const lon = num(bias.lng);
    if (isCep(query)) return lookupCep(query, { ...opts, viaCepUrl, lat, lon });
    return searchPlaces(query, { ...opts, limit: 5, lat, lon });
  }

  async function reverse(lat, lng) {
    if (disabled) return null;
    return reversePlace(lat, lng, opts);
  }

  // Resolve an approximate position from the request's client IP.
  async function fromRequest(req) {
    if (disabled) return null;
    const ip = clientIp(req);
    // For a private/loopback caller (local dev), ask the provider for its own
    // view of the IP by passing an empty IP; public IPs are looked up directly.
    const lookupIp = isPublicIp(ip) ? ip : '';
    return locateByIp(lookupIp, { ipUrl, fetchImpl, timeoutMs });
  }

  return { search, reverse, fromRequest };
}
