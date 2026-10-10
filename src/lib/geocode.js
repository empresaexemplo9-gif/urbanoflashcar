// Keyless geocoding + IP geolocation, done server-side so the browser only
// talks to our own origin. Every function takes an injected `fetch` (so tests
// run offline and deterministically) and never throws: on any failure —
// network, timeout, bad JSON, upstream error — it resolves to an empty result
// and the caller/UI falls back to manual entry.

// Fetch JSON with a hard timeout. Returns null on any problem.
async function getJson(url, { fetchImpl, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        // Photon/Nominatim ask for an identifying User-Agent (fair-use policy).
        'User-Agent': 'UrbanoFlashCar/1.0 (+https://github.com/empresaexemplo9-gif/urbanoflashcar)',
        Accept: 'application/json',
      },
    });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null; // aborted, offline, or non-JSON — treat as "no result".
  } finally {
    clearTimeout(timer);
  }
}

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

// A Brazilian CEP is 8 digits, usually written NNNNN-NNN.
export function normalizeCep(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}
export function isCep(value) {
  return normalizeCep(value) !== null;
}
const formatCep = (d) => `${d.slice(0, 5)}-${d.slice(5)}`;

// Turn a Photon GeoJSON feature into our flat place { label, lat, lng }.
export function featureToPlace(f) {
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates)) return null;
  const [lng, lat] = f.geometry.coordinates.map(Number);
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) return null;
  const p = f.properties || {};
  const street = p.street ? p.street + (p.housenumber ? ', ' + p.housenumber : '') : null;
  const parts = [p.name, street, p.city || p.town || p.village || p.county, p.state].filter(Boolean);
  const label = [...new Set(parts)].join(' · ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return { label, lat, lng };
}

// Address autocomplete. Returns an array of places (possibly empty). When a
// bias coordinate (lat/lon) is given, results near it are ranked first — so a
// street + sector search resolves to the one in the rider's own city.
export async function searchPlaces(query, { photonUrl, fetchImpl, timeoutMs, limit = 5, lat, lon }) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  let url = `${photonUrl}/api?q=${encodeURIComponent(q)}&limit=${limit}&lang=pt`;
  if (isFiniteNum(Number(lat)) && isFiniteNum(Number(lon))) {
    url += `&lat=${Number(lat)}&lon=${Number(lon)}`;
  }
  const data = await getJson(url, { fetchImpl, timeoutMs });
  if (!data || !Array.isArray(data.features)) return [];
  return data.features.map(featureToPlace).filter(Boolean);
}

// Resolve a Brazilian CEP to a located place. ViaCEP (keyless) gives the
// address (logradouro/bairro/cidade/UF); we then geocode that address through
// Photon to attach coordinates — the label stays the authoritative CEP address.
export async function lookupCep(cep, { viaCepUrl, photonUrl, fetchImpl, timeoutMs, lat, lon }) {
  const digits = normalizeCep(cep);
  if (!digits) return [];
  const addr = await getJson(viaCepUrl.replace('{cep}', digits), { fetchImpl, timeoutMs });
  if (!addr || addr.erro) return [];

  const { logradouro, bairro, localidade, uf } = addr;
  const labelParts = [logradouro, bairro, localidade && uf ? `${localidade} - ${uf}` : localidade, `CEP ${formatCep(digits)}`].filter(Boolean);
  const label = labelParts.join(' · ');

  // Geocode the most specific address we have to get coordinates.
  const queries = [];
  if (logradouro && localidade) queries.push(`${logradouro}, ${bairro ? bairro + ', ' : ''}${localidade}, ${uf}`);
  if (localidade) queries.push(`${localidade}, ${uf}`);
  for (const q of queries) {
    const found = await searchPlaces(q, { photonUrl, fetchImpl, timeoutMs, limit: 1, lat, lon });
    if (found.length) return [{ label, lat: found[0].lat, lng: found[0].lng }];
  }
  return []; // could not attach a coordinate — nothing usable for a ride.
}

// Reverse geocode a coordinate to a human label. Always returns a place:
// falls back to the formatted coordinate when the service has nothing.
export async function reversePlace(lat, lng, { photonUrl, fetchImpl, timeoutMs }) {
  const latN = Number(lat);
  const lngN = Number(lng);
  const fallback = { label: `${latN.toFixed(5)}, ${lngN.toFixed(5)}`, lat: latN, lng: lngN };
  if (!isFiniteNum(latN) || !isFiniteNum(lngN)) return null;
  const url = `${photonUrl}/reverse?lat=${latN}&lon=${lngN}&lang=pt`;
  const data = await getJson(url, { fetchImpl, timeoutMs });
  const place = data && Array.isArray(data.features) ? featureToPlace(data.features[0]) : null;
  return place || fallback;
}

// Approximate location from an IP address. `ipUrl` may contain "{ip}" (filled
// with the given IP) or be a bare base (resolves the caller's own IP — used
// when the server can't determine a routable client IP). Returns
// { lat, lng, label, approx: true } or null.
export async function locateByIp(ip, { ipUrl, fetchImpl, timeoutMs }) {
  const url = ipUrl.includes('{ip}') ? ipUrl.replace('{ip}', encodeURIComponent(ip || '')) : ipUrl;
  const d = await getJson(url, { fetchImpl, timeoutMs });
  if (!d) return null;
  // Tolerate the common field spellings across providers.
  const lat = Number(d.latitude ?? d.lat);
  const lng = Number(d.longitude ?? d.lon ?? d.lng);
  if (!isFiniteNum(lat) || !isFiniteNum(lng) || (lat === 0 && lng === 0)) return null;
  const parts = [d.city, d.region ?? d.region_name ?? d.state, d.country ?? d.country_name].filter(Boolean);
  const label = parts.length ? parts.join(', ') : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return { lat, lng, label, approx: true };
}
