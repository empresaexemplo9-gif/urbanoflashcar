// UrbanoFlashCar web client. Talks to the REST API, keeps the session token in
// localStorage, and renders the rider/driver journeys. No framework, no build.

const TOKEN_KEY = 'ufc_token';
const $ = (sel) => document.querySelector(sel);

// A few preset locations (São Paulo) so the demo journey needs no geocoder.
const PRESETS = [
  { label: 'Av. Paulista', lat: -23.5614, lng: -46.6559 },
  { label: 'Estação da Luz', lat: -23.5347, lng: -46.6356 },
  { label: 'Parque Ibirapuera', lat: -23.5874, lng: -46.6576 },
  { label: 'Aeroporto de Congonhas', lat: -23.6273, lng: -46.6566 },
  { label: 'Mercado Municipal', lat: -23.5419, lng: -46.6295 },
  { label: 'USP Butantã', lat: -23.5595, lng: -46.7313 },
];

const state = { token: localStorage.getItem(TOKEN_KEY), user: null };

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
    if (state.user.role === 'rider') loadRiderRides();
    else { loadAvailable(); loadDriverRides(); }
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
    localStorage.setItem(TOKEN_KEY, token);
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
    localStorage.setItem(TOKEN_KEY, token);
    toast('Conta criada!', 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.token = null; state.user = null;
  localStorage.removeItem(TOKEN_KEY);
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

// --- Google Maps: localização real (mapa + autocomplete + geolocalização) ---
const maps = { ready: false, map: null, markers: {}, geocoder: null };

async function setupMaps() {
  let cfg;
  try { cfg = await api('/config'); } catch { cfg = {}; }
  if (!cfg || !cfg.mapsApiKey) return; // sem chave → modo presets/manual (maps-off)
  try {
    await loadGoogleMaps(cfg.mapsApiKey);
    initMapsUI();
  } catch { /* falha ao carregar → permanece no modo manual */ }
}

function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const cb = '__ufcMapsReady';
    window[cb] = () => resolve();
    const s = document.createElement('script');
    s.src =
      'https://maps.googleapis.com/maps/api/js?' +
      `key=${encodeURIComponent(key)}&libraries=places&language=pt-BR&region=BR&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error('Falha ao carregar o Google Maps'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('timeout')), 12000);
  });
}

function initMapsUI() {
  maps.ready = true;
  maps.geocoder = new google.maps.Geocoder();
  maps.map = new google.maps.Map($('#map'), {
    center: { lat: -23.5558, lng: -46.6396 },
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });
  $('#ride-form').classList.replace('maps-off', 'maps-on');

  for (const target of ['pickup', 'dropoff']) {
    const input = $(`#${target}-search`);
    const ac = new google.maps.places.Autocomplete(input, {
      fields: ['geometry', 'name', 'formatted_address'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place.geometry) return;
      const loc = place.geometry.location;
      const label = place.formatted_address || place.name || input.value;
      input.value = label;
      mapsSetPlace(target, { label, lat: loc.lat(), lng: loc.lng() });
    });
  }

  $('#geoloc-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Geolocalização indisponível.', 'err');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const label = await reverseGeocode(latitude, longitude);
        const input = $('#pickup-search'); if (input) input.value = label;
        mapsSetPlace('pickup', { label, lat: latitude, lng: longitude });
      },
      () => toast('Não foi possível obter sua localização.', 'err'),
    );
  });
}

function mapsSetPlace(target, place) {
  $(`[name="${target}-label"]`).value = place.label;
  $(`[name="${target}-lat"]`).value = place.lat;
  $(`[name="${target}-lng"]`).value = place.lng;
  if (!maps.ready) return;
  const pos = { lat: place.lat, lng: place.lng };
  if (maps.markers[target]) {
    maps.markers[target].setPosition(pos);
  } else {
    const marker = new google.maps.Marker({
      map: maps.map, position: pos, draggable: true,
      label: target === 'pickup' ? 'A' : 'B',
    });
    marker.addListener('dragend', async () => {
      const p = marker.getPosition();
      $(`[name="${target}-lat"]`).value = p.lat();
      $(`[name="${target}-lng"]`).value = p.lng();
      const label = await reverseGeocode(p.lat(), p.lng());
      $(`[name="${target}-label"]`).value = label;
      const input = $(`#${target}-search`); if (input) input.value = label;
    });
    maps.markers[target] = marker;
  }
  fitMarkers();
}

function fitMarkers() {
  const ms = Object.values(maps.markers);
  if (!ms.length) return;
  if (ms.length === 1) { maps.map.setCenter(ms[0].getPosition()); maps.map.setZoom(15); return; }
  const bounds = new google.maps.LatLngBounds();
  ms.forEach((m) => bounds.extend(m.getPosition()));
  maps.map.fitBounds(bounds, 60);
}

function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    if (!maps.geocoder) return resolve(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    maps.geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      resolve(status === 'OK' && results[0] ? results[0].formatted_address : `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    });
  });
}

function clearMaps() {
  for (const t of Object.keys(maps.markers)) { maps.markers[t].setMap(null); delete maps.markers[t]; }
  const ps = $('#pickup-search'); if (ps) ps.value = '';
  const ds = $('#dropoff-search'); if (ds) ds.value = '';
}

function readPlaces() {
  const num = (n) => Number($(`[name="${n}"]`).value);
  return {
    pickup: { label: $('[name="pickup-label"]').value.trim(), lat: num('pickup-lat'), lng: num('pickup-lng') },
    dropoff: { label: $('[name="dropoff-label"]').value.trim(), lat: num('dropoff-lat'), lng: num('dropoff-lng') },
  };
}

$('#estimate-btn').addEventListener('click', async () => {
  try {
    const est = await api('/estimate', { method: 'POST', body: readPlaces() });
    const box = $('#estimate-box');
    box.hidden = false;
    box.innerHTML = `<div class="fare">${money(est.fareCents)}</div>
      <div>${est.distanceKm} km · ~${Math.round(est.durationMin)} min</div>`;
  } catch (err) { toast(err.message, 'err'); }
});

$('#ride-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/rides', { method: 'POST', body: readPlaces() });
    toast('Corrida solicitada!', 'ok');
    $('#estimate-box').hidden = true;
    e.target.reset();
    clearMaps();
    loadRiderRides();
  } catch (err) { toast(err.message, 'err'); }
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
  li.innerHTML = `
    <div class="route">${escapeHtml(ride.pickup.label)} → ${escapeHtml(ride.dropoff.label)}</div>
    <div class="meta">${money(ride.fareCents)} · ${ride.distanceKm} km · ~${Math.round(ride.durationMin)} min</div>
    <div><span class="badge ${ride.status}">${STATUS_PT[ride.status] || ride.status}</span></div>
    ${paymentLine}
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

async function loadRiderRides() {
  try {
    const { rides } = await api('/rides');
    fill('#rides-list', rides, (r) =>
      ['requested', 'accepted'].includes(r.status)
        ? [{ label: 'Cancelar', run: () => transition(r.id, 'cancel') }]
        : []);
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
        { label: 'Cancelar', run: () => transition(r.id, 'cancel') },
      ];
      if (r.status === 'in_progress') return [{ label: 'Concluir', run: () => transition(r.id, 'complete') }];
      return paymentActions(r);
    });
  } catch (err) { toast(err.message, 'err'); }
}

$('#refresh-rides').addEventListener('click', loadRiderRides);
$('#refresh-available').addEventListener('click', loadAvailable);
$('#refresh-driver-rides').addEventListener('click', loadDriverRides);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- PWA: service worker + install prompt -------------------------------
function setupPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
    });
  }

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

// --- Boot ---------------------------------------------------------------
async function boot() {
  setupPwa();
  setupAuthTabs();
  setupPresets();
  setupMaps();
  if (state.token) {
    try {
      const { user } = await api('/me');
      state.user = user;
    } catch {
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  render();
}

boot();
