'use strict';
// Red Panda Inventory — browser app. Talks to the server REST API and listens on /api/events for live updates.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { items: new Map(), count: new Map(), mode: 'in', tab: 'scan', pin: '' };

try { state.pin = localStorage.getItem('rp_pin') || ''; } catch {}

// ---------- API ----------
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (state.pin) headers['x-pin'] = state.pin;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401) { askPin(); throw Object.assign(new Error('PIN required'), { status: 401 }); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), data, { status: res.status });
  return data;
}

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (Math.round(Number(n) * 1000) / 1000).toLocaleString();
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTime = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const isLow = (it) => it.min_qty > 0 && it.qty <= it.min_qty;

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

let audio;
function beep(ok = true) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = ok ? 1200 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
    if (!ok && navigator.vibrate) navigator.vibrate(200);
  } catch {}
}

// ---------- tabs & modes ----------
function showTab(name) {
  state.tab = name;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
  if (name === 'scan') $('#scanInput').focus();
  if (name === 'count') $('#countInput').focus();
  if (name === 'history') loadHistory();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

function setMode(mode) {
  state.mode = mode;
  $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#scanInput').placeholder = mode === 'count' ? 'Scan, then qty = new on-hand amount' : 'Scan barcode or type SKU, then Enter';
  $('#scanInput').focus();
}
$$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------- scanning (auto key-in) ----------
async function handleScan(code, source = 'scanner') {
  code = code.trim();
  if (!code) return;
  if (state.tab === 'count') return handleCount(code);
  const qty = Number($('#scanQty').value) || (state.mode === 'count' ? 0 : 1);
  try {
    const r = await api('/api/movements', { method: 'POST', body: { barcode: code, type: state.mode, qty, source } });
    beep(true);
    showLast(r.item, r.movement);
    if (state.mode === 'count') $('#scanQty').value = 1, setMode('in');
  } catch (err) {
    beep(false);
    if (err.unknown) {
      showLastUnknown(code);
      openItem(null, { barcode: code, qty: state.mode === 'out' ? 0 : qty });
    } else if (err.status !== 401) {
      toast(err.message);
    }
  }
}

function showLast(item, mv) {
  const el = $('#lastScan');
  el.className = `last ok-${mv.type === 'adjust' ? 'in' : mv.type}`;
  el.innerHTML = `
    <div class="muted">${mv.type === 'in' ? 'Stock in' : mv.type === 'out' ? 'Stock out' : 'Set to'} · ${esc(item.barcode || item.sku || '')}</div>
    <div class="name">${esc(item.name)}</div>
    <div><span class="big ${mv.delta >= 0 ? 'pos' : 'neg'}">${signed(mv.delta)}</span>
      <span class="muted"> → now </span><b class="big">${fmt(item.qty)}</b> <span class="muted">${esc(item.unit)}</span>
      ${isLow(item) ? '<span class="badge">LOW</span>' : ''}</div>`;
}

function showLastUnknown(code) {
  const el = $('#lastScan');
  el.className = 'last bad';
  el.innerHTML = `<div class="name">Unknown barcode ${esc(code)}</div><div class="muted">Fill in the item details to add it.</div>`;
}

function addFeed(mv) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="d ${mv.delta >= 0 ? 'pos' : 'neg'}">${signed(mv.delta)}</span>
    <span>${esc(mv.item_name)} <span class="muted">→ ${fmt(mv.qty_after)} ${esc(mv.unit)}</span></span>
    <span class="t">${esc(mv.source)} · ${time(mv.created_at)}</span>`;
  const log = $('#scanLog');
  log.prepend(li);
  while (log.children.length > 15) log.lastChild.remove();
}

$('#scanForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#scanInput').value;
  $('#scanInput').value = '';
  handleScan(v, 'scanner');
});
$('#countForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#countInput').value;
  $('#countInput').value = '';
  handleCount(v.trim());
});

// Keyboard-wedge scanners type fast and end with Enter. Catch them even when no input is focused.
let buf = '';
let lastKey = 0;
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('dialog[open]')) return;
  const t = performance.now();
  if (t - lastKey > 80) buf = '';
  lastKey = t;
  if (e.key === 'Enter') {
    if (buf.length >= 3) { e.preventDefault(); handleScan(buf, 'scanner'); }
    buf = '';
  } else if (e.key.length === 1) buf += e.key;
});

// ---------- camera scanning ----------
let camStream = null;
let camLoop = null;
async function getDetector() {
  if ('BarcodeDetector' in window) {
    const formats = await BarcodeDetector.getSupportedFormats();
    const d = new BarcodeDetector({ formats });
    return async (video) => (await d.detect(video))[0]?.rawValue;
  }
  // Safari / Firefox fallback (needs internet the first time).
  const { BrowserMultiFormatReader } = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
  const reader = new BrowserMultiFormatReader();
  const canvas = document.createElement('canvas');
  return async (video) => {
    if (!video.videoWidth) return undefined;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    try { return reader.decodeFromCanvas(canvas).getText(); } catch { return undefined; }
  };
}

async function startCamera() {
  try {
    const video = $('#camVideo');
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = camStream;
    await video.play();
    $('#camWrap').classList.remove('hidden');
    if (state.tab !== 'scan') {
      $('#tab-' + state.tab).prepend($('#camWrap'));
    } else {
      $('#scanForm').after($('#camWrap'));
    }
    const detect = await getDetector();
    let lastCode = '';
    let lastAt = 0;
    const tick = async () => {
      if (!camStream) return;
      const code = await detect(video).catch(() => undefined);
      const t = Date.now();
      if (code && (code !== lastCode || t - lastAt > 2000)) {
        lastCode = code;
        lastAt = t;
        await handleScan(code, 'camera');
      }
      camLoop = setTimeout(tick, 250);
    };
    tick();
  } catch (err) {
    toast('Camera unavailable: ' + (err.message || err) + ' (camera needs HTTPS)');
    stopCamera();
  }
}
function stopCamera() {
  clearTimeout(camLoop);
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('#camWrap').classList.add('hidden');
}
$('#camBtn').addEventListener('click', () => (camStream ? stopCamera() : startCamera()));
$('#camBtn2').addEventListener('click', () => (camStream ? stopCamera() : startCamera()));
$('#camStop').addEventListener('click', stopCamera);

// ---------- stock list ----------
function renderItems() {
  const q = $('#search').value.trim().toLowerCase();
  const lowOnly = $('#lowOnly').checked;
  const items = [...state.items.values()]
    .filter((it) => !lowOnly || isLow(it))
    .filter((it) => !q || [it.name, it.barcode, it.sku, it.category].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  $('#itemRows').innerHTML = items.map(itemRow).join('');
  $('#emptyStock').classList.toggle('hidden', state.items.size > 0);
  renderStats();
}

function itemRow(it) {
  return `<tr data-id="${it.id}" class="${isLow(it) ? 'low' : ''}">
    <td class="name">${esc(it.name)}${isLow(it) ? '<span class="badge">LOW</span>' : ''}<small>${esc(it.category)}</small></td>
    <td>${esc(it.barcode || '')}<br><small class="muted">${esc(it.sku || '')}</small></td>
    <td class="num"><span class="qtycell">${fmt(it.qty)}</span> <small class="muted">${esc(it.unit)}</small></td>
    <td class="num muted">${fmt(it.min_qty)}</td>
    <td><div class="rowbtns">
      <button class="btn sm" data-act="out" title="Stock out 1">−</button>
      <button class="btn sm" data-act="in" title="Stock in 1">+</button>
      <button class="btn sm" data-act="edit">Edit</button></div></td></tr>`;
}

function renderStats() {
  const items = [...state.items.values()];
  const low = items.filter(isLow).length;
  $('#statItems').textContent = items.length;
  $('#statLow').textContent = low;
  $('#statLowWrap').classList.toggle('has', low > 0);
  $('#categories').innerHTML = [...new Set(items.map((i) => i.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('');
}

function flashItem(id) {
  const tr = document.querySelector(`#itemRows tr[data-id="${id}"]`);
  if (tr) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); }
}

$('#search').addEventListener('input', renderItems);
$('#lowOnly').addEventListener('change', renderItems);
$('#itemRows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = Number(btn.closest('tr').dataset.id);
  if (btn.dataset.act === 'edit') return openItem(state.items.get(id));
  try {
    await api('/api/movements', { method: 'POST', body: { item_id: id, type: btn.dataset.act, qty: 1, source: 'app' } });
  } catch (err) { if (err.status !== 401) toast(err.message); }
});

// ---------- item dialog ----------
let editing = null;
function openItem(item, preset = {}) {
  editing = item;
  const f = $('#itemForm');
  f.reset();
  $('#itemErr').textContent = '';
  $('#itemDlgTitle').textContent = item ? 'Edit item' : 'New item';
  $('#qtyLabel').firstChild.textContent = item ? 'On hand' : 'Opening qty';
  $('#deleteBtn').classList.toggle('hidden', !item);
  const v = { unit: 'pcs', qty: 0, min_qty: 0, ...(item || {}), ...preset };
  for (const k of ['name', 'barcode', 'sku', 'category', 'unit', 'qty', 'min_qty']) f.elements[k].value = v[k] ?? '';
  $('#itemDlg').showModal();
  f.elements.name.focus();
}
$('#addBtn').addEventListener('click', () => openItem(null));
$('#itemForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const f = e.target;
  const body = Object.fromEntries(['name', 'barcode', 'sku', 'category', 'unit', 'qty', 'min_qty'].map((k) => [k, f.elements[k].value]));
  body.source = 'app';
  try {
    const saved = editing
      ? await api(`/api/items/${editing.id}`, { method: 'PATCH', body })
      : await api('/api/items', { method: 'POST', body });
    state.items.set(saved.id, saved);
    renderItems();
    $('#itemDlg').close();
    toast(`Saved ${saved.name}`);
    if (state.tab === 'scan') $('#scanInput').focus();
  } catch (err) {
    $('#itemErr').textContent = err.message;
  }
});
$('#deleteBtn').addEventListener('click', async () => {
  if (!editing || !confirm(`Delete “${editing.name}” and its history?`)) return;
  try {
    await api(`/api/items/${editing.id}`, { method: 'DELETE' });
    state.items.delete(editing.id);
    renderItems();
    $('#itemDlg').close();
  } catch (err) { $('#itemErr').textContent = err.message; }
});

// ---------- CSV ----------
$('#exportBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const csv = await api('/api/export.csv');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `red-panda-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) { if (err.status !== 401) toast(err.message); }
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const r = await api('/api/import', { method: 'POST', body: await file.text(), raw: true });
    toast(`Imported: ${r.created} new, ${r.updated} updated`);
  } catch (err) { if (err.status !== 401) toast(err.message); }
});

// ---------- live count ----------
async function handleCount(code) {
  if (!code) return;
  try {
    const row = await api('/api/count', { method: 'POST', body: { barcode: code, qty: Number($('#countQty').value) || 1 } });
    beep(true);
    state.count.set(row.item_id, row);
    renderCount(row.item_id);
  } catch (err) {
    beep(false);
    if (err.unknown) { toast(`Unknown barcode ${code}`); openItem(null, { barcode: code, qty: 0 }); }
    else if (err.status !== 401) toast(err.message);
  }
}

function renderCount(flashId) {
  const rows = [...state.count.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  $('#countRows').innerHTML = rows.map((r) => {
    const it = state.items.get(r.item_id) || {};
    const sys = it.qty ?? r.system_qty;
    const diff = r.counted - sys;
    return `<tr data-id="${r.item_id}">
      <td class="name">${esc(it.name || r.name)}<small>${esc(it.barcode || r.barcode || '')}</small></td>
      <td class="num"><input class="cset" type="number" step="any" min="0" value="${r.counted}" style="width:80px;text-align:right;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg)"></td>
      <td class="num muted">${fmt(sys)}</td>
      <td class="num ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'muted'}">${signed(diff)}</td>
      <td><div class="rowbtns"><button class="btn sm" data-act="rm" title="Remove from count">✕</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">Nothing counted yet — start scanning.</td></tr>';
  const units = rows.reduce((s, r) => s + r.counted, 0);
  $('#countSummary').textContent = rows.length ? `${rows.length} items · ${fmt(units)} units counted` : '';
  if (flashId) {
    const tr = document.querySelector(`#countRows tr[data-id="${flashId}"]`);
    tr?.classList.add('flash');
  }
}

$('#countRows').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('cset')) return;
  const id = Number(e.target.closest('tr').dataset.id);
  try { await api('/api/count', { method: 'POST', body: { item_id: id, set: Number(e.target.value) } }); }
  catch (err) { toast(err.message); }
});
$('#countRows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="rm"]');
  if (!btn) return;
  await api(`/api/count/${btn.closest('tr').dataset.id}`, { method: 'DELETE' }).catch((err) => toast(err.message));
});
$('#countCommit').addEventListener('click', async () => {
  if (!state.count.size) return toast('Nothing counted yet');
  if (!confirm(`Set stock for ${state.count.size} items to the counted numbers?`)) return;
  const r = await api('/api/count/commit', { method: 'POST', body: { source: 'stocktake' } }).catch((err) => toast(err.message));
  if (r) toast(`Stock updated for ${r.committed} items`);
});
$('#countClear').addEventListener('click', async () => {
  if (state.count.size && confirm('Discard the current count? Stock is not changed.')) {
    await api('/api/count/clear', { method: 'POST' }).catch((err) => toast(err.message));
  }
});

// ---------- history ----------
const TYPE_LABEL = { in: 'In', out: 'Out', count: 'Set', adjust: 'Adjust' };
function historyRow(m) {
  return `<tr><td class="muted">${dateTime(m.created_at)}</td><td class="name">${esc(m.item_name)}</td><td>${TYPE_LABEL[m.type] || m.type}</td>
    <td class="num ${m.delta >= 0 ? 'pos' : 'neg'}">${signed(m.delta)}</td><td class="num">${fmt(m.qty_after)}</td>
    <td class="muted">${esc(m.note)}${m.note && m.source ? ' · ' : ''}${esc(m.source)}</td></tr>`;
}
async function loadHistory() {
  try {
    const rows = await api('/api/movements?limit=300');
    $('#historyRows').innerHTML = rows.map(historyRow).join('') || '<tr><td colspan="6" class="empty">No stock movements yet.</td></tr>';
  } catch {}
}

// ---------- live updates ----------
let es;
function setLive(on, text) {
  $('#live').className = 'live ' + (on ? 'on' : 'off');
  $('#liveText').textContent = text;
}
function connect() {
  es?.close();
  es = new EventSource('/api/events' + (state.pin ? `?pin=${encodeURIComponent(state.pin)}` : ''));
  es.onopen = () => { setLive(true, 'live'); loadAll(); };
  es.onerror = () => setLive(false, 'reconnecting…');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    switch (ev.type) {
      case 'presence':
      case 'hello':
        setLive(true, `live · ${ev.clients} device${ev.clients === 1 ? '' : 's'}`);
        break;
      case 'item':
        state.items.set(ev.item.id, ev.item);
        renderItems();
        break;
      case 'item_deleted':
        state.items.delete(ev.id);
        state.count.delete(ev.id);
        renderItems();
        renderCount();
        break;
      case 'movement':
        state.items.set(ev.item.id, ev.item);
        renderItems();
        flashItem(ev.item.id);
        addFeed(ev.movement);
        if (state.count.size) renderCount();
        if (state.tab === 'history') $('#historyRows').insertAdjacentHTML('afterbegin', historyRow(ev.movement));
        if (isLow(ev.item) && ev.movement.delta < 0) toast(`Low stock: ${ev.item.name} (${fmt(ev.item.qty)} left)`);
        break;
      case 'count':
        state.count.set(ev.row.item_id, ev.row);
        renderCount(ev.row.item_id);
        break;
      case 'count_removed':
        state.count.delete(ev.item_id);
        renderCount();
        break;
      case 'count_cleared':
        state.count.clear();
        renderCount();
        break;
      case 'reload':
        loadAll();
        break;
    }
  };
}

async function loadAll() {
  const [items, count] = await Promise.all([api('/api/items'), api('/api/count')]);
  state.items = new Map(items.map((i) => [i.id, i]));
  state.count = new Map(count.map((r) => [r.item_id, r]));
  renderItems();
  renderCount();
  if (state.tab === 'history') loadHistory();
}

// ---------- PIN ----------
function askPin() {
  if ($('#pinDlg').open) return;
  es?.close();
  setLive(false, 'locked');
  $('#pinErr').textContent = state.pin ? 'Wrong PIN' : '';
  $('#pinDlg').showModal();
  $('#pinInput').focus();
}
$('#pinForm').addEventListener('submit', async () => {
  state.pin = $('#pinInput').value.trim();
  try { localStorage.setItem('rp_pin', state.pin); } catch {}
  try { await api('/api/items'); connect(); } catch {}
});

// ---------- start ----------
(async function start() {
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    if (health.auth && !state.pin) return askPin();
    await api('/api/items');
    connect();
  } catch {}
})();
