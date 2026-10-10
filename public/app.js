// UrbanoFlashCar web client. Talks to the REST API, keeps the session token in
// localStorage, and renders the rider/driver journeys. No framework, no build.

const TOKEN_KEY = 'ufc_token';
const $ = (sel) => document.querySelector(sel);

// Safe storage: localStorage can throw at access time in some runtimes
// (privacy modes, packaged webviews with storage disabled). A throw here must
// never abort module evaluation and leave the UI unwired, so every access is
// guarded and degrades to an in-memory fallback.
let memToken = null;
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return memToken; } },
  set(v) { memToken = v; try { localStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } },
  clear() { memToken = null; try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

// A few preset locations (São Paulo) so the demo journey needs no geocoder.
const PRESETS = [
  { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 },
  { label: 'Estação da Luz', lat: -23.5347, lng: -46.6356 },
  { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 },
  { label: 'Aeroporto de Congonhas', lat: -23.6273, lng: -46.6566 },
  { label: 'Mercado Municipal', lat: -23.5419, lng: -46.6295 },
  { label: 'USP Butantã', lat: -23.5595, lng: -46.7313 },
];

const state = { token: store.get(), user: null, categories: [], selectedCategory: 'economy' };

// --- Modal (reused for chat + receipt) ----------------------------------
const modal = { pollTimer: null };
function openModal(title, buildBody) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  buildBody(body);
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
  if (modal.pollTimer) { clearInterval(modal.pollTimer); modal.pollTimer = null; }
  $('#modal-body').innerHTML = '';
}

// --- API helper ---------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Erro ${res.status}`);
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3200);
}

const money = (cents) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
const STATUS_PT = {
  requested: 'Solicitada', accepted: 'Aceita', in_progress: 'Em andamento',
  completed: 'Concluída', cancelled: 'Cancelada',
};
const PAYMENT_PT = { pending: 'pendente', received: 'recebido' };
const METHOD_PT = { pix: 'Pix', card: 'cartão' };

// --- View switching -----------------------------------------------------
function render() {
  const authed = Boolean(state.user);
  $('#auth-view').hidden = authed;
  $('#session-box').hidden = !authed;
  $('#rider-view').hidden = !(authed && state.user.role === 'rider');
  $('#driver-view').hidden = !(authed && state.user.role === 'driver');

  if (authed) {
    $('#session-user').textContent = `${state.user.name} · ${state.user.role === 'driver' ? 'Motorista' : 'Passageiro'}`;
    if (state.user.role === 'rider') {
      showRiderScreen('home');
      loadRiderRides();
      loadFavorites();
      loadCategories();
      startLiveLocation(); // current location is always active for riders
    } else { loadAvailable(); loadDriverRides(); }
  }
}

// --- Auth ---------------------------------------------------------------
function setupAuthTabs() {
  const show = (which) => {
    const login = which === 'login';
    $('#tab-login').classList.toggle('is-active', login);
    $('#tab-register').classList.toggle('is-active', !login);
    $('#tab-login').setAttribute('aria-selected', String(login));
    $('#tab-register').setAttribute('aria-selected', String(!login));
    $('#login-form').hidden = !login;
    $('#register-form').hidden = login;
  };
  $('#tab-login').addEventListener('click', () => show('login'));
  $('#tab-register').addEventListener('click', () => show('register'));
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { token, user } = await api('/auth/login', {
      method: 'POST',
      body: { email: f.get('email'), password: f.get('password') },
    });
    state.token = token; state.user = user;
    store.set(token);
    toast('Bem-vindo(a)!', 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/auth/register', {
      method: 'POST',
      body: { name: f.get('name'), email: f.get('email'), password: f.get('password'), role: f.get('role') },
    });
    // Auto-login after registering.
    const { token, user } = await api('/auth/login', {
      method: 'POST',
      body: { email: f.get('email'), password: f.get('password') },
    });
    state.token = token; state.user = user;
    store.set(token);
    toast('Conta criada!', 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
});

$('#logout-btn').addEventListener('click', async () => {
  // Go offline before the token is invalidated, otherwise the driver stays
  // visible to riders until the freshness window expires.
  if (presence.online) {
    try { await api('/driver/offline', { method: 'POST' }); } catch { /* ignore */ }
  }
  stopPresence();
  stopLiveLocation();
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.token = null; state.user = null;
  store.clear();
  render();
});

// --- Ride form ----------------------------------------------------------
function setupPresets() {
  for (const sel of document.querySelectorAll('.preset')) {
    const opt = (label, value) => {
      const o = document.createElement('option');
      o.textContent = label; o.value = value; return o;
    };
    sel.appendChild(opt('— escolher local —', ''));
    PRESETS.forEach((p, i) => sel.appendChild(opt(p.label, String(i))));
    sel.addEventListener('change', () => {
      const idx = sel.value;
      if (idx === '') return;
      const p = PRESETS[Number(idx)];
      const t = sel.dataset.target;
      $(`[name="${t}-label"]`).value = p.label;
      $(`[name="${t}-lat"]`).value = p.lat;
      $(`[name="${t}-lng"]`).value = p.lng;
    });
  }
}

// --- Mapa gratuito e sem chave: Leaflet + OpenStreetMap + Photon ----------
// A busca de endereços, o reverse geocoding e o fallback por IP passam pelo
// nosso próprio servidor (/api/geo/*), não por hosts de terceiros. Assim o
// navegador só fala com este app: ad-blockers/tracking-protection não têm como
// bloquear (é same-origin), não há CORS e o fallback por IP usa o IP real que
// o servidor enxerga. Se a rede/Leaflet não carregar, cai no modo manual.
const maps = { ready: false, map: null, markers: {} };

// Live current location, kept always active while the rider uses the app (see
// startLiveLocation). `coords` biases address search toward the rider's city.
const geo = { coords: null, watchId: null, started: false };

// Resolve the user's real current position: device GPS first (the true, exact
// location — needs a secure context: HTTPS or localhost), then the server-side
// IP fallback. Returns { lat, lng, label, approx } or null. Never throws.
function devicePosition(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, approx: false }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
function ipPosition() {
  return fetch('/api/geo/ip', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => (d && d.place ? d.place : null)) // { lat, lng, label, approx:true }
    .catch(() => null);
}
async function resolveCurrentPlace() {
  const gps = await devicePosition();
  if (gps) {
    const base = await reverseGeocode(gps.lat, gps.lng);
    return { label: base, lat: gps.lat, lng: gps.lng };
  }
  const ip = await ipPosition();
  if (ip) return { label: `${ip.label} (aprox.)`, lat: ip.lat, lng: ip.lng };
  return null;
}
// Fill the pickup with the real current location. `silent` suppresses the
// error toast (used for the automatic fill on opening a new ride). With
// `onlyIfEmpty`, the pickup is re-checked AFTER the async lookup and left
// alone if the rider meanwhile chose one (favorite/preset/autocomplete), so a
// slow GPS/IP result never overwrites a deliberate choice.
const pickupIsEmpty = () => $('[name="pickup-lat"]').value.trim() === '';
async function useCurrentLocation({ silent = false, onlyIfEmpty = false } = {}) {
  const place = await resolveCurrentPlace();
  if (!place) {
    if (!silent) toast('Não foi possível obter sua localização.', 'err');
    return false;
  }
  if (onlyIfEmpty && !pickupIsEmpty()) return false; // rider set it while we resolved
  setSearchValue('pickup', place.label);
  mapsSetPlace('pickup', place);
  return true;
}

// Paint the small "location active" status line in the new-ride screen.
function setGeoStatus(text, kind = '') {
  const el = $('#geo-status');
  if (!el) return;
  el.textContent = text;
  el.className = `geo-status ${kind}`;
}

// Keep the current location ALWAYS active while the rider is on the platform.
// Device GPS is watched continuously (secure context required); if it is
// denied/unavailable we fall back once to the server-side IP position. The
// freshest coordinate is kept in `geo.coords` and used to bias address search
// and to default the pickup. Idempotent: safe to call on every render.
function startLiveLocation() {
  if (geo.started) return;
  geo.started = true;
  setGeoStatus('📍 Obtendo sua localização atual…');

  const apply = (coords, approx) => {
    geo.coords = coords;
    reverseGeocode(coords.lat, coords.lng).then((label) => {
      setGeoStatus(`📍 Localização ativa${approx ? ' (aproximada)' : ''}: ${label}`, approx ? 'approx' : 'live');
    });
    // Default the pickup to the live location while the rider hasn't chosen one.
    if (pickupIsEmpty()) {
      reverseGeocode(coords.lat, coords.lng).then((label) => {
        if (!pickupIsEmpty()) return;
        setSearchValue('pickup', approx ? `${label} (aprox.)` : label);
        mapsSetPlace('pickup', { label, lat: coords.lat, lng: coords.lng });
      });
    }
  };

  const useIpOnce = () =>
    ipPosition().then((ip) => {
      if (ip) apply({ lat: ip.lat, lng: ip.lng }, true);
      else setGeoStatus('📍 Localização indisponível — informe origem e destino.', 'err');
    });

  if (navigator.geolocation) {
    geo.watchId = navigator.geolocation.watchPosition(
      (pos) => apply({ lat: pos.coords.latitude, lng: pos.coords.longitude }, false),
      () => { if (!geo.coords) useIpOnce(); }, // denied/timeout → IP fallback once
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );
  } else {
    useIpOnce();
  }
}

function stopLiveLocation() {
  if (geo.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(geo.watchId);
  geo.watchId = null;
  geo.coords = null;
  geo.started = false;
}

function setupMaps() {
  if (typeof L === 'undefined') return; // Leaflet não carregou → modo manual
  try { initMapsUI(); } catch { /* falha → permanece no modo manual */ }
}

function initMapsUI() {
  maps.map = L.map('map', { zoomControl: true }).setView([-23.5558, -46.6396], 12);
  // Host oficial exigido pela política de tiles do OSM (sem subdomínios {s}).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; colaboradores do OpenStreetMap',
  }).addTo(maps.map);

  for (const target of ['pickup', 'dropoff']) setupAutocomplete(target);

  // Clicar no mapa define o ponto que ainda falta (origem, depois destino).
  maps.map.on('click', async (e) => {
    const target = !maps.markers.pickup ? 'pickup' : !maps.markers.dropoff ? 'dropoff' : null;
    if (!target) return;
    const { lat, lng } = e.latlng;
    const label = await reverseGeocode(lat, lng);
    setSearchValue(target, label);
    mapsSetPlace(target, { label, lat, lng });
  });

  $('#geoloc-btn').addEventListener('click', () => useCurrentLocation());

  maps.ready = true;
  $('#ride-form').classList.replace('maps-off', 'maps-on');
  setTimeout(() => maps.map.invalidateSize(), 0);
}

function setSearchValue(target, v) { const i = $(`#${target}-search`); if (i) i.value = v; }

// Autocomplete de endereços reais via Photon (gratuito, baseado em OSM).
function setupAutocomplete(target) {
  const input = $(`#${target}-search`);
  const list = document.createElement('div');
  list.className = 'ac-list';
  list.hidden = true;
  input.insertAdjacentElement('afterend', list);

  let timer;
  let seq = 0; // descarta respostas de buscas antigas que chegam atrasadas
  input.addEventListener('input', () => {
    invalidatePlace(target); // texto mudou → coordenadas antigas não valem mais
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { list.hidden = true; list.innerHTML = ''; return; }
    const mySeq = ++seq;
    timer = setTimeout(async () => {
      const items = await photonSearch(q);
      if (mySeq !== seq) return; // uma busca mais nova já foi disparada
      renderSuggestions(list, items, (item) => {
        setSearchValue(target, item.label);
        list.hidden = true;
        mapsSetPlace(target, item);
      });
    }, 350);
  });
  // Esconde a lista ao sair do campo, mas não quando o foco vai para a própria
  // lista (permite ativar uma sugestão pelo teclado).
  input.addEventListener('blur', () =>
    setTimeout(() => { if (!list.contains(document.activeElement)) list.hidden = true; }, 180));
}

function renderSuggestions(list, items, onPick) {
  list.innerHTML = '';
  if (!items.length) { list.hidden = true; return; }
  for (const item of items) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ac-item';
    el.textContent = item.label;
    // 'click' fires for pointer AND keyboard (Enter/Space on a <button>), so
    // keyboard-only users can select. mousedown only keeps input focus so the
    // blur handler doesn't hide the list before the click lands.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => onPick(item));
    list.appendChild(el);
  }
  list.hidden = false;
}

// Autocomplete via our same-origin proxy (server talks to Photon/ViaCEP).
// Accepts "rua + setor/bairro" or a CEP; biases results to the live location.
async function photonSearch(q) {
  try {
    let url = `/api/geo/search?q=${encodeURIComponent(q)}`;
    if (geo.coords) url += `&lat=${geo.coords.lat}&lng=${geo.coords.lng}`;
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data.places) ? data.places : [];
  } catch { return []; }
}

// Reverse geocode via our same-origin proxy. Always returns a label string.
function reverseGeocode(lat, lng) {
  const fallback = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  return fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`)
    .then((r) => r.json())
    .then((d) => (d && d.place && d.place.label ? d.place.label : fallback))
    .catch(() => fallback);
}

function markerIcon(letter) {
  return L.divIcon({
    className: 'pin',
    html: `<span class="pin-dot">${letter}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function mapsSetPlace(target, place) {
  $(`[name="${target}-label"]`).value = place.label;
  $(`[name="${target}-lat"]`).value = place.lat;
  $(`[name="${target}-lng"]`).value = place.lng;
  if (!maps.ready) return;
  const pos = [place.lat, place.lng];
  if (maps.markers[target]) {
    maps.markers[target].setLatLng(pos);
  } else {
    const marker = L.marker(pos, {
      draggable: true,
      icon: markerIcon(target === 'pickup' ? 'A' : 'B'),
    }).addTo(maps.map);
    marker.on('dragend', async () => {
      const ll = marker.getLatLng();
      $(`[name="${target}-lat"]`).value = ll.lat;
      $(`[name="${target}-lng"]`).value = ll.lng;
      const label = await reverseGeocode(ll.lat, ll.lng);
      $(`[name="${target}-label"]`).value = label;
      setSearchValue(target, label);
    });
    maps.markers[target] = marker;
  }
  fitMarkers();
}

function fitMarkers() {
  const ms = Object.values(maps.markers);
  if (!ms.length) return;
  if (ms.length === 1) { maps.map.setView(ms[0].getLatLng(), 15); return; }
  maps.map.fitBounds(L.latLngBounds(ms.map((m) => m.getLatLng())).pad(0.25));
}

// Drop the saved coordinates + marker for one endpoint so a stale, no-longer-
// matching location can't be submitted. The typed label text stays.
function invalidatePlace(target) {
  $(`[name="${target}-lat"]`).value = '';
  $(`[name="${target}-lng"]`).value = '';
  if (maps.markers[target]) { maps.map.removeLayer(maps.markers[target]); delete maps.markers[target]; }
}

function clearMaps() {
  if (!maps.ready) return;
  for (const t of Object.keys(maps.markers)) { maps.map.removeLayer(maps.markers[t]); delete maps.markers[t]; }
  setSearchValue('pickup', ''); setSearchValue('dropoff', '');
}

function readPlaces() {
  // Blank fields must stay invalid: Number('') is 0, which is a real coordinate
  // (Gulf of Guinea) and would slip past the NaN guards, so map empty to NaN.
  const num = (n) => {
    const raw = $(`[name="${n}"]`).value.trim();
    return raw === '' ? NaN : Number(raw);
  };
  return {
    pickup: { label: $('[name="pickup-label"]').value.trim(), lat: num('pickup-lat'), lng: num('pickup-lng') },
    dropoff: { label: $('[name="dropoff-label"]').value.trim(), lat: num('dropoff-lat'), lng: num('dropoff-lng') },
  };
}

// --- Ride categories (tiers) + coupon + schedule ------------------------
const promoValue = () => $('#promo-input').value.trim();
const scheduleValue = () => {
  const v = $('#schedule-input').value;
  return v ? new Date(v).toISOString() : null; // datetime-local → ISO (local tz)
};

// Body for /estimate and /rides: places + chosen category/coupon/schedule.
function rideBody() {
  const body = { ...readPlaces(), category: state.selectedCategory };
  const promo = promoValue();
  if (promo) body.promoCode = promo;
  const sched = scheduleValue();
  if (sched) body.scheduledFor = sched;
  return body;
}

async function loadCategories() {
  try {
    const { categories } = await api('/categories');
    state.categories = categories;
    if (!categories.some((c) => c.id === state.selectedCategory)) {
      state.selectedCategory = categories[0]?.id || 'economy';
    }
    renderCategories();
  } catch { /* categories are optional sugar; ignore if offline */ }
}

// Render the tier cards; `prices` maps category id → fareCents (from an estimate).
function renderCategories(prices = null) {
  const list = $('#category-list');
  if (!list) return;
  list.innerHTML = '';
  for (const c of state.categories) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `category-card${c.id === state.selectedCategory ? ' is-selected' : ''}`;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(c.id === state.selectedCategory));
    const price = prices && prices[c.id] != null ? money(prices[c.id]) : `${c.seats} lug.`;
    card.innerHTML = `<span><span class="cat-name">${escapeHtml(c.label)}</span><br>
      <span class="cat-desc">${escapeHtml(c.description || '')}</span></span>
      <span class="cat-price">${price}</span>`;
    card.addEventListener('click', () => { state.selectedCategory = c.id; renderCategories(prices); doEstimate(true); });
    list.appendChild(card);
  }
}

// Shared estimate: fills the estimate box and prices every category card.
// `silent` suppresses the error toast (used on category click before places set).
async function doEstimate(silent = false) {
  const places = readPlaces();
  if (Number.isNaN(places.pickup.lat) || Number.isNaN(places.dropoff.lat)) {
    if (!silent) toast('Defina origem e destino para estimar.', 'err');
    return;
  }
  try {
    const est = await api('/estimate', { method: 'POST', body: rideBody() });
    const prices = {};
    for (const o of est.options || []) prices[o.id] = o.fareCents;
    renderCategories(prices);
    const box = $('#estimate-box');
    box.hidden = false;
    const discount = est.discountCents
      ? `<div class="rated-line">Cupom ${escapeHtml(est.promoCode)}: −${money(est.discountCents)}</div>`
      : '';
    box.innerHTML = `<div class="fare">${money(est.fareCents)}</div>
      <div>${est.distanceKm} km · ~${Math.round(est.durationMin)} min · ${escapeHtml(labelForCategory(est.category))}</div>
      ${discount}`;
  } catch (err) { if (!silent) toast(err.message, 'err'); }
}
const labelForCategory = (id) => (state.categories.find((c) => c.id === id) || {}).label || id;

$('#estimate-btn').addEventListener('click', () => doEstimate());

$('#ride-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { ride } = await api('/rides', { method: 'POST', body: rideBody() });
    toast(ride.scheduledFor ? 'Corrida agendada!' : 'Corrida solicitada!', 'ok');
    $('#estimate-box').hidden = true;
    $('#nearby-box').hidden = true;
    e.target.reset();
    state.selectedCategory = state.categories[0]?.id || 'economy';
    renderCategories();
    clearMaps();
    showRiderScreen('home');
    loadRiderRides();
  } catch (err) { toast(err.message, 'err'); }
});

// --- Rider screens: home (favoritos) ↔ nova corrida ---------------------
function showRiderScreen(which) {
  const newRide = which === 'newride';
  $('#rider-home').hidden = newRide;
  $('#rider-newride').hidden = !newRide;
  if (newRide && maps.ready && maps.map) setTimeout(() => maps.map.invalidateSize(), 60);
}
$('#new-ride-btn').addEventListener('click', () => {
  showRiderScreen('newride');
  // Always start from the user's real current location: auto-fill the pickup
  // when it is empty. onlyIfEmpty re-checks after the async lookup so a pickup
  // chosen meanwhile (favorite/preset/autocomplete) is never overwritten.
  if (pickupIsEmpty()) useCurrentLocation({ silent: true, onlyIfEmpty: true });
});
$('#back-home-btn').addEventListener('click', () => showRiderScreen('home'));

// --- Favoritos ----------------------------------------------------------
async function loadFavorites() {
  try {
    const { favorites } = await api('/favorites');
    const ul = $('#favorites-list');
    ul.innerHTML = '';
    if (!favorites.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nenhuma rota favorita. Salve uma ao solicitar uma corrida.';
      ul.appendChild(li);
      return;
    }
    for (const fav of favorites) {
      const li = document.createElement('li');
      li.className = 'ride';
      li.innerHTML = `
        <div class="route">${escapeHtml(fav.label)}</div>
        <div class="meta">${escapeHtml(fav.pickup.label)} → ${escapeHtml(fav.dropoff.label)}</div>
        <div class="ride-actions"></div>`;
      const bar = li.querySelector('.ride-actions');
      const use = document.createElement('button');
      use.className = 'btn btn-primary btn-sm';
      use.textContent = 'Usar';
      use.addEventListener('click', () => useFavorite(fav));
      const del = document.createElement('button');
      del.className = 'btn btn-ghost btn-sm';
      del.textContent = 'Excluir';
      del.addEventListener('click', () => deleteFavorite(fav.id));
      bar.append(use, del);
      ul.appendChild(li);
    }
  } catch (err) { toast(err.message, 'err'); }
}

function useFavorite(fav) {
  showRiderScreen('newride');
  mapsSetPlace('pickup', { label: fav.pickup.label, lat: fav.pickup.lat, lng: fav.pickup.lng });
  mapsSetPlace('dropoff', { label: fav.dropoff.label, lat: fav.dropoff.lat, lng: fav.dropoff.lng });
  setSearchValue('pickup', fav.pickup.label);
  setSearchValue('dropoff', fav.dropoff.label);
  toast('Rota carregada. Confira e solicite.', 'ok');
}

async function deleteFavorite(id) {
  try {
    await api(`/favorites/${id}`, { method: 'DELETE' });
    loadFavorites();
  } catch (err) { toast(err.message, 'err'); }
}

$('#save-fav-btn').addEventListener('click', async () => {
  const places = readPlaces();
  const invalid = (p) => !p.label || Number.isNaN(p.lat) || Number.isNaN(p.lng);
  if (invalid(places.pickup) || invalid(places.dropoff)) {
    return toast('Defina origem e destino antes de salvar.', 'err');
  }
  const label = window.prompt('Nome da rota favorita:', `${places.pickup.label} → ${places.dropoff.label}`);
  if (!label) return;
  try {
    await api('/favorites', { method: 'POST', body: { label, pickup: places.pickup, dropoff: places.dropoff } });
    toast('Rota favorita salva!', 'ok');
    loadFavorites();
  } catch (err) { toast(err.message, 'err'); }
});

// --- Motoristas próximos ------------------------------------------------
$('#find-drivers-btn').addEventListener('click', async () => {
  const { pickup } = readPlaces();
  if (Number.isNaN(pickup.lat) || Number.isNaN(pickup.lng)) {
    return toast('Defina a origem para procurar motoristas.', 'err');
  }
  const box = $('#nearby-box');
  box.hidden = false;
  box.textContent = 'Procurando motoristas próximos…';
  try {
    const { drivers } = await api(`/drivers/nearby?lat=${pickup.lat}&lng=${pickup.lng}`);
    if (!drivers.length) {
      box.innerHTML = '<div class="meta">Nenhum motorista parceiro próximo no momento.</div>';
      return;
    }
    box.innerHTML = '<div class="meta">Motoristas parceiros próximos:</div>' +
      drivers.map((d) => {
        const rating = d.rating && d.rating.avg != null
          ? ` <span class="rating-chip">★ ${d.rating.avg}</span>` : '';
        return `<div class="nearby-item"><span>🚗 ${escapeHtml(d.name)}${rating}</span>` +
          `<span>${d.distanceKm} km · ~${Math.round(d.etaMin)} min</span></div>`;
      }).join('');
  } catch (err) { box.hidden = true; toast(err.message, 'err'); }
});

// --- Ride rendering -----------------------------------------------------
function rideCard(ride, actions) {
  const li = document.createElement('li');
  li.className = 'ride';
  const paymentLine = ride.payment
    ? `<div class="meta">Pagamento: ${PAYMENT_PT[ride.payment.status] || ride.payment.status}${
        ride.payment.status === 'received' && ride.payment.method
          ? ` via ${METHOD_PT[ride.payment.method] || ride.payment.method}`
          : ''
      }</div>`
    : '';
  const cat = labelForCategory(ride.category || 'economy');
  const scheduled = ride.scheduledFor
    ? `<div class="meta">🗓️ Agendada para ${new Date(ride.scheduledFor).toLocaleString('pt-BR')}</div>` : '';
  const tipLine = ride.tipCents ? ` · gorjeta ${money(ride.tipCents)}` : '';
  const cancelLine = ride.status === 'cancelled' && ride.cancelReason
    ? `<div class="meta">Motivo: ${escapeHtml(ride.cancelReason)}</div>` : '';
  li.innerHTML = `
    <div class="route">${escapeHtml(ride.pickup.label)} → ${escapeHtml(ride.dropoff.label)}</div>
    <div class="meta">${money(ride.fareCents)}${tipLine} · ${ride.distanceKm} km · ~${Math.round(ride.durationMin)} min · ${escapeHtml(cat)}</div>
    ${scheduled}
    <div><span class="badge ${ride.status}">${STATUS_PT[ride.status] || ride.status}</span></div>
    ${paymentLine}
    ${cancelLine}
    <div class="ride-actions"></div>`;
  const bar = li.querySelector('.ride-actions');
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = a.label;
    btn.addEventListener('click', () => a.run(ride));
    bar.appendChild(btn);
  }
  return li;
}

function fill(listSel, rides, actionsFor) {
  const ul = $(listSel);
  ul.innerHTML = '';
  if (!rides.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nenhuma corrida por aqui ainda.';
    ul.appendChild(li);
    return;
  }
  rides.forEach((r) => ul.appendChild(rideCard(r, actionsFor(r))));
}

async function transition(id, action) {
  try {
    await api(`/rides/${id}/${action}`, { method: 'POST' });
    toast('Atualizado.', 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
}

// The driver confirms they received the payment directly, choosing the method.
async function confirmPayment(id, method) {
  try {
    const { payment } = await api(`/rides/${id}/payment/confirm`, { method: 'POST', body: { method } });
    toast(`Pagamento recebido via ${METHOD_PT[payment.method] || payment.method}.`, 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
}

// Driver-side actions to confirm receipt on a completed ride with a pending payment.
function paymentActions(ride) {
  return ride.status === 'completed' && ride.payment && ride.payment.status === 'pending'
    ? [
        { label: 'Recebi via Pix', run: () => confirmPayment(ride.id, 'pix') },
        { label: 'Recebi via cartão', run: () => confirmPayment(ride.id, 'card') },
      ]
    : [];
}

// --- In-ride chat -------------------------------------------------------
async function openChat(rideId) {
  openModal('Chat da corrida', (body) => {
    const thread = document.createElement('div');
    thread.className = 'chat-thread';
    const form = document.createElement('form');
    form.className = 'chat-form';
    form.innerHTML = '<input type="text" placeholder="Escreva uma mensagem" autocomplete="off" maxlength="1000" /><button type="submit" class="btn btn-primary btn-sm">Enviar</button>';
    body.append(thread, form);

    const paint = (messages) => {
      thread.innerHTML = '';
      for (const m of messages) {
        const el = document.createElement('div');
        el.className = `chat-msg ${m.senderId === state.user.id ? 'mine' : 'theirs'}`;
        el.textContent = m.body;
        thread.appendChild(el);
      }
      thread.scrollTop = thread.scrollHeight;
    };
    const refresh = async () => {
      try { const { messages } = await api(`/rides/${rideId}/messages`); paint(messages); }
      catch { /* ignore transient errors while open */ }
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      try { await api(`/rides/${rideId}/messages`, { method: 'POST', body: { body: text } }); input.value = ''; refresh(); }
      catch (err) { toast(err.message, 'err'); }
    });
    refresh();
    modal.pollTimer = setInterval(refresh, 4000); // live-ish updates while open
  });
}

// --- Receipt + tip (rider) ----------------------------------------------
async function openReceipt(rideId, canTip) {
  try {
    const { receipt } = await api(`/rides/${rideId}/receipt`);
    openModal('Recibo', (body) => {
      const line = (label, cents, cls = '') =>
        `<div class="receipt-line ${cls}"><span>${label}</span><span>${money(cents)}</span></div>`;
      let html = line(`Tarifa (${escapeHtml(labelForCategory(receipt.category))})`, receipt.baseFareCents);
      if (receipt.discountCents) html += line(`Cupom ${escapeHtml(receipt.promoCode || '')}`, -receipt.discountCents);
      if (receipt.tipCents) html += line('Gorjeta', receipt.tipCents);
      html += line('Total', receipt.totalCents, 'total');
      html += `<div class="rated-line" style="margin-top:8px">${receipt.distanceKm} km · ~${Math.round(receipt.durationMin)} min</div>`;
      body.innerHTML = html;

      if (canTip) {
        const row = document.createElement('div');
        row.className = 'tip-row';
        row.innerHTML = '<span class="rated-line">Gorjeta:</span>';
        for (const cents of [200, 500, 1000]) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = `+ ${money(cents)}`;
          b.addEventListener('click', async () => {
            try {
              await api(`/rides/${rideId}/tip`, { method: 'POST', body: { tipCents: (receipt.tipCents || 0) + cents } });
              toast('Gorjeta registrada. Obrigado!', 'ok');
              closeModal(); loadRiderRides();
            } catch (err) { toast(err.message, 'err'); }
          });
          row.appendChild(b);
        }
        body.appendChild(row);
      }
    });
  } catch (err) { toast(err.message, 'err'); }
}

// --- Rating -------------------------------------------------------------
async function openRating(rideId) {
  let existing = null;
  try { const res = await api(`/rides/${rideId}/rating`); existing = res.rating; } catch { /* ignore */ }
  openModal('Avaliar', (body) => {
    if (existing) {
      body.innerHTML = `<div class="rated-line">Você já avaliou: ${'★'.repeat(existing.stars)}${'☆'.repeat(5 - existing.stars)}</div>`
        + (existing.comment ? `<div class="rated-line">“${escapeHtml(existing.comment)}”</div>` : '');
      return;
    }
    let chosen = 0;
    const stars = document.createElement('div');
    stars.className = 'stars';
    const paint = () => stars.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('on', i < chosen));
    for (let i = 1; i <= 5; i += 1) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'star-btn'; b.textContent = '★'; b.setAttribute('aria-label', `${i} estrela(s)`);
      b.addEventListener('click', () => { chosen = i; paint(); });
      stars.appendChild(b);
    }
    const comment = document.createElement('input');
    comment.type = 'text'; comment.placeholder = 'Comentário (opcional)'; comment.maxLength = 500; comment.style.marginTop = '10px'; comment.style.width = '100%';
    const send = document.createElement('button');
    send.type = 'button'; send.className = 'btn btn-primary'; send.textContent = 'Enviar avaliação'; send.style.marginTop = '10px';
    send.addEventListener('click', async () => {
      if (chosen < 1) return toast('Escolha de 1 a 5 estrelas.', 'err');
      try {
        await api(`/rides/${rideId}/rate`, { method: 'POST', body: { stars: chosen, comment: comment.value.trim() || undefined } });
        toast('Avaliação enviada. Obrigado!', 'ok');
        closeModal(); render();
      } catch (err) { toast(err.message, 'err'); }
    });
    body.append(stars, comment, send);
  });
}

async function loadRiderRides() {
  try {
    const { rides } = await api('/rides');
    fill('#rides-list', rides, (r) => {
      if (['requested', 'accepted'].includes(r.status)) {
        const acts = [{ label: 'Cancelar', run: () => transition(r.id, 'cancel') }];
        if (r.status === 'accepted') acts.push({ label: '💬 Chat', run: () => openChat(r.id) });
        return acts;
      }
      if (r.status === 'in_progress') return [{ label: '💬 Chat', run: () => openChat(r.id) }];
      if (r.status === 'completed') return [
        { label: '🧾 Recibo / gorjeta', run: () => openReceipt(r.id, true) },
        { label: '★ Avaliar', run: () => openRating(r.id) },
      ];
      return [];
    });
  } catch (err) { toast(err.message, 'err'); }
}

async function loadAvailable() {
  try {
    const { rides } = await api('/rides/available');
    fill('#available-list', rides, (r) => [{ label: 'Aceitar', run: () => transition(r.id, 'accept') }]);
  } catch (err) { toast(err.message, 'err'); }
}

async function loadDriverRides() {
  try {
    const { rides } = await api('/rides');
    fill('#driver-rides-list', rides, (r) => {
      if (r.status === 'accepted') return [
        { label: 'Iniciar', run: () => transition(r.id, 'start') },
        { label: '💬 Chat', run: () => openChat(r.id) },
        { label: 'Cancelar', run: () => transition(r.id, 'cancel') },
      ];
      if (r.status === 'in_progress') return [
        { label: 'Concluir', run: () => transition(r.id, 'complete') },
        { label: '💬 Chat', run: () => openChat(r.id) },
      ];
      if (r.status === 'completed') return [...paymentActions(r), { label: '★ Avaliar', run: () => openRating(r.id) }];
      return paymentActions(r);
    });
  } catch (err) { toast(err.message, 'err'); }
}

$('#refresh-rides').addEventListener('click', loadRiderRides);
$('#refresh-available').addEventListener('click', loadAvailable);
$('#refresh-driver-rides').addEventListener('click', loadDriverRides);

// --- Disponibilidade do motorista (ficar online + localização) ----------
const presence = { online: false, timer: null };

function setDriverOnline(online) {
  presence.online = online;
  const btn = $('#online-toggle');
  const status = $('#online-status');
  if (btn) btn.textContent = online ? 'Ficar offline' : 'Ficar online';
  if (status) {
    status.textContent = online
      ? 'Online — compartilhando sua localização; você aparece aos passageiros.'
      : 'Offline — compartilhe sua localização para aparecer aos passageiros.';
  }
}

function pushDriverLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { toast('Geolocalização indisponível.', 'err'); return resolve(false); }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api('/driver/location', { method: 'POST', body: { available: true, lat: pos.coords.latitude, lng: pos.coords.longitude } });
          resolve(true);
        } catch (err) { toast(err.message, 'err'); resolve(false); }
      },
      () => { toast('Não foi possível obter sua localização.', 'err'); resolve(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function stopPresence() {
  if (presence.timer) { clearInterval(presence.timer); presence.timer = null; }
  presence.online = false;
}

const onlineToggle = $('#online-toggle');
if (onlineToggle) {
  onlineToggle.addEventListener('click', async () => {
    if (presence.online) {
      stopPresence();
      try { await api('/driver/offline', { method: 'POST' }); } catch { /* ignore */ }
      setDriverOnline(false);
      toast('Você está offline.', 'ok');
    } else {
      const ok = await pushDriverLocation();
      if (!ok) return;
      setDriverOnline(true);
      toast('Você está online.', 'ok');
      presence.timer = setInterval(pushDriverLocation, 30000); // reenvia a posição
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Running inside the Electron desktop shell? There the UI is served by the
// app's own local server, so the service worker adds nothing and only risks
// serving a stale shell on the fixed localhost origin — skip it there.
const IS_ELECTRON = /Electron/i.test(navigator.userAgent || '');

// --- PWA: service worker + install prompt + auto-update -----------------
function setupPwa() {
  if ('serviceWorker' in navigator && !IS_ELECTRON) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => setupAutoUpdate(reg))
        .catch(() => { /* non-fatal */ });
    });
  }
  watchPlatformVersion();

  // Custom install button (Chromium browsers fire beforeinstallprompt).
  let deferredPrompt = null;
  const btn = $('#install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.hidden = false;
  });
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.hidden = true;
    });
  }
  window.addEventListener('appinstalled', () => { if (btn) btn.hidden = true; });
}

// Keep the installed app (PWA on mobile/desktop) in lockstep with the
// platform. When the server ships a new version the service worker's bytes
// change (see the /sw.js route), so a new worker installs; once it takes
// control we reload once to pick up the new shell.
function setupAutoUpdate(reg) {
  let reloading = false;
  let updateReady = false; // true only for a real update, never the first install
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  // Arm the reload. Only ever called when a controller already exists, so the
  // very first install (no controller yet) never arms it. Idempotent.
  const arm = () => {
    if (updateReady) return;
    updateReady = true;
    toast('Atualizando para a versão mais recente…', 'ok');
  };

  // Watch one worker: if it is already installed with a controller present it
  // is a ready update; otherwise wait for it to reach that state.
  const track = (w) => {
    if (!w) return;
    if (w.state === 'installed' && navigator.serviceWorker.controller) { arm(); return; }
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) arm();
    });
  };

  // A worker already in flight when we attached (an update another tab or a
  // background browser check discovered, whose `updatefound` already fired):
  // pick it up directly, since the event won't fire again for it.
  track(reg.waiting);
  track(reg.installing);

  // Future updates: a new worker starts installing.
  reg.addEventListener('updatefound', () => track(reg.installing));

  // The new worker took control (skipWaiting + clients.claim in sw.js): reload
  // so the running page matches it — but only for a genuine update, so the
  // first install never triggers a spurious reload.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateReady) reloadOnce();
  });

  // Check for a new worker periodically and whenever the app regains focus, so
  // a long-open app still updates without being reopened.
  const check = () => { reg.update().catch(() => {}); };
  setInterval(check, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
}

// Shows the running platform version and, as a fallback for environments
// without a service worker, reloads when the server reports a newer one.
let loadedVersion = null;
async function watchPlatformVersion() {
  const paint = (v) => { const el = $('#app-version'); if (el && v) el.textContent = `v${v}`; };
  const poll = async () => {
    try {
      const { version } = await api('/version');
      if (!version) return;
      if (loadedVersion === null) { loadedVersion = version; paint(version); return; }
      if (version !== loadedVersion) {
        // A newer platform is live. The service worker handles the reload when
        // present; otherwise reload directly so the app never lags behind.
        if (!(navigator.serviceWorker && navigator.serviceWorker.controller)) {
          toast('Atualizando para a versão mais recente…', 'ok');
          setTimeout(() => window.location.reload(), 600);
        }
      }
    } catch { /* offline: try again later */ }
  };
  await poll();
  setInterval(poll, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

// --- Boot ---------------------------------------------------------------
// Each setup step is isolated: a failure in one (e.g. the map library did not
// load) must never stop the UI from rendering. render() always runs.
function safe(fn) {
  try { fn(); } catch (err) { console.error('[boot]', err); }
}

function setupModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
}

async function boot() {
  safe(setupPwa);
  safe(setupAuthTabs);
  safe(setupPresets);
  safe(setupMaps);
  safe(setupModal);
  if (state.token) {
    try {
      const { user } = await api('/me');
      state.user = user;
    } catch {
      state.token = null;
      store.clear();
    }
  }
  try { render(); } catch (err) { console.error('[boot:render]', err); }
}

boot();
