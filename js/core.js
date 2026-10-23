'use strict';
/* =========================================================
   CloudCut — studio montażu wideo w przeglądarce
   core.js — stan projektu, narzędzia, klatki kluczowe, historia,
   zapis w IndexedDB, import mediów i napisów.
   Wszystko dzieje się lokalnie: pliki nie opuszczają komputera.
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
/* Wersja na komputer (CloudCut.exe) — znacznik ustawia desktop/preload.js */
const IS_DESKTOP = !!window.cloudcutDesktop;
/* Polska odmiana: plural(5, 'plik', 'pliki', 'plików') → „5 plików” */
const plural = (n, one, few, many) =>
  `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
const uid = p => p + Date.now().toString(36).slice(-5) + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
const EPS = 1e-4;

const ICON = {
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
};

/* ---------------- Stan ---------------- */
const mkTrack = (id, kind, name) => ({ id, kind, name, hidden: false, muted: false, locked: false, solo: false, vol: 1, pan: 0 });
function newState() {
  return {
    w: 1920, h: 1080, fps: 30, bg: '#000000',
    tracks: [mkTrack('t1', 'text', 'T1'), mkTrack('v2', 'video', 'V2'), mkTrack('v1', 'video', 'V1'), mkTrack('a1', 'audio', 'A1'), mkTrack('a2', 'audio', 'A2')],
    clips: [], markers: [], range: null, folders: [], mediaFolder: {},
  };
}

const media = new Map();   // id -> opis pliku (wraz z blobem i adresem obiektu)
const players = new Map(); // clipId -> { el, gain, src, mediaId }
let state = newState();
let project = { id: null, name: 'Nowy projekt' };
let sel = new Set();
let playhead = 0, playing = false, rate = 1, playT0 = 0, playP0 = 0, scrubbing = false;
let playStopAt = null, playAroundOrigin = 0;
let pps = 80, snapOn = true, tool = 'select', loopOn = false;
let audioCtx = null, master = null, monitorGain = null, exportDest = null, analysers = null;
let monVolume = 1;
let exporting = null;
let clipboard = null;
let renderScale = 1;
let monitor = 'program';

/* ---------------- Pomocnicze ---------------- */
const frame = () => 1 / state.fps;
function tc(t, fps = state.fps) {
  const tot = Math.round(Math.max(0, t) * fps);
  const fr = tot % fps, s = Math.floor(tot / fps), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return (h ? h + ':' : '') + String(m % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ':' + String(fr).padStart(2, '0');
}
function shortDur(t) {
  if (!isFinite(t)) return '—';
  const s = Math.round(t), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return (h ? h + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}
function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}
/* Okno z polem tekstowym zamiast prompt(), którego nie ma w wersji na komputer (Electron).
   Zwraca wpisany tekst albo null po „Anuluj” / Escape. */
function ask(label, value = '', { title = '', text = '', type = 'text', ok = 'OK', danger = false } = {}) {
  const dlg = $('#askDlg'), input = $('#askInput');
  $('#askTitle').textContent = title || label;
  $('#askLabel').textContent = label;
  $('#askLabel').classList.toggle('sr-only', !title);
  $('#askText').textContent = text;
  $('#askText').hidden = !text;
  input.type = type;
  input.value = value;
  input.autocomplete = type === 'password' ? 'current-password' : 'off';
  $('#askOk').textContent = ok;
  $('#askOk').classList.toggle('danger-fill', danger);
  return new Promise(resolve => {
    const done = v => { dlg.close(); resolve(v); };
    $('#askForm').onsubmit = e => { e.preventDefault(); done(input.value); };
    $('#askCancel').onclick = () => done(null);
    dlg.oncancel = e => { e.preventDefault(); done(null); };
    dlg.showModal();
    input.focus();
    if (type !== 'password') input.select();
  });
}
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) {
  const ks = p.split('.');
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] ??= {};
  a[ks[ks.length - 1]] = v;
}
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const trackOf = c => state.tracks.find(t => t.id === c.trackId);
const clipById = id => state.clips.find(c => c.id === id);
const clipsOn = trackId => state.clips.filter(c => c.trackId === trackId).sort((a, b) => a.start - b.start);
const laneKind = kind => (kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : 'video');
const projectEnd = () => state.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
const isAV = c => c.kind === 'video' || c.kind === 'audio';
/* Prędkość klipu od −100× do 100×; ujemna = odtwarzanie wstecz. c.in to zawsze miejsce w pliku na początku klipu,
   więc materiał w chwili t to c.in + (t − c.start) · c.speed — także przy prędkości ujemnej. */
const SPEED_MIN = 0.1, SPEED_MAX = 100;
const fmtSpeed = s => String(+(+s).toFixed(Math.abs(s) < 10 ? 2 : 1)).replace('.', ',');
/* Zapas materiału (w sekundach osi czasu) przed początkiem i za końcem klipu */
function roomBefore(c, m) { const D = m?.duration ?? Infinity; return c.speed > 0 ? c.in / c.speed : (D - c.in) / -c.speed; }
function roomAfter(c, m) { const D = m?.duration ?? Infinity, end = c.in + c.dur * c.speed; return Math.max(0, c.speed > 0 ? (D - end) / c.speed : end / -c.speed); }
const isVisual = c => c.kind !== 'audio';
const clipEnd = c => c.start + c.dur;
const selectedClips = () => state.clips.filter(c => sel.has(c.id));
const isLocked = c => !!trackOf(c)?.locked;
const groupMembers = c => (c.group ? state.clips.filter(x => x.group === c.group) : [c]);

function overlaps(trackId, s, e, exclude) {
  const ex = exclude instanceof Set ? exclude : new Set(exclude ? [exclude] : []);
  return state.clips.some(c => c.trackId === trackId && !ex.has(c.id) && s < c.start + c.dur - EPS && e > c.start + EPS);
}
function freeSlot(trackId, start, dur, exclude) {
  let s = Math.max(0, start);
  for (let guard = 0; guard < 1000; guard++) {
    const hit = state.clips.find(c => c.trackId === trackId && c.id !== exclude && s < c.start + c.dur - EPS && s + dur > c.start + EPS);
    if (!hit) break;
    s = hit.start + hit.dur;
  }
  return s;
}
function defaultTrack(kind) {
  const list = state.tracks.filter(t => t.kind === kind && !t.locked);
  if (!list.length) return addTrack(kind, false);
  return kind === 'video' ? list[list.length - 1] : list[0]; // V1 to najniższa ścieżka wideo
}

/* ---------------- Właściwości klipów ---------------- */
const FX0 = { brightness: 100, contrast: 100, saturate: 100, hue: 0, temp: 0, blur: 0, grayscale: 0, sepia: 0, vignette: 0 };
function visualProps() {
  return {
    opacity: 1, scale: 1, x: 0, y: 0, rotation: 0, flipH: false, flipV: false, fit: 'contain',
    crop: { l: 0, r: 0, t: 0, b: 0 }, radius: 0, dropShadow: false, blend: 'source-over', kfEase: 'smooth',
    mask: { type: 'none', x: 0, y: 0, w: 60, h: 60, feather: 0, invert: false, round: 0 }, lut: null,
    fx: { ...FX0 }, key: { on: false, color: '#00d046', tol: 28, soft: 12 },
    inType: 'fade', outType: 'fade', fadeIn: 0, fadeOut: 0,
  };
}
function defaultProps(kind) {
  if (kind === 'audio') return { volume: 1, fadeIn: 0, fadeOut: 0, inType: 'fade', outType: 'fade', afx: { ...AFX0 }, kfEase: 'smooth' };
  const p = visualProps();
  if (kind === 'video') Object.assign(p, { volume: 1, detached: false, afx: { ...AFX0 } });
  if (kind === 'text') Object.assign(p, {
    text: 'Twój tytuł', font: 'Inter', size: 110, weight: 700, italic: false, upper: false, color: '#ffffff', align: 'center',
    spacing: 0, lineHeight: 1.15, stroke: 0, strokeColor: '#000000', bg: false, bgColor: '#000000', bgOpacity: 0.6,
    shadow: true, glow: false, y: Math.round(state.h * 0.28), fadeIn: 0.4, fadeOut: 0.4,
    // wypełnienie: jeden kolor albo gradient z dowolną liczbą kolorów (c = kolor, p = położenie 0–100%)
    fillType: 'solid', gradAngle: 90, gradStops: [{ c: '#ff6b8b', p: 0 }, { c: '#ffd34d', p: 100 }],
  });
  if (kind === 'color') Object.assign(p, { c1: '#1b2a6b', c2: '#c0396b', grad: 'linear', angle: 135 });
  if (kind === 'shape') Object.assign(p, { shape: 'roundrect', w: 520, h: 300, fill: '#6b95ff', fillOn: true, stroke: '#ffffff', strokeW: 0, corner: 28, points: 5 });
  if (kind === 'element') Object.assign(p, { el: 'progress', color: '#ff4d5e', color2: '#ffffff', count: 5, text: 'SUBSKRYBUJ', speed: 1, seed: 1, ratio: 2.39, barH: 14 });
  return p;
}
/* Klipy ze starszych projektów dostają brakujące właściwości (maska, efekty audio…) */
function fillDefaults(c) {
  const d = defaultProps(c.kind);
  for (const [k, v] of Object.entries(d)) {
    if (c.props[k] === undefined) c.props[k] = structuredClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && c.props[k] && typeof c.props[k] === 'object') {
      for (const [kk, vv] of Object.entries(v)) if (c.props[k][kk] === undefined) c.props[k][kk] = vv;
    }
  }
  c.kf ??= {};
  c.speed ??= 1;
  return c;
}
function newClip(kind, trackId, start, dur, extra = {}) {
  return { id: uid('c'), kind, mediaId: null, trackId, start, in: 0, dur, speed: 1, name: '', group: null, props: defaultProps(kind), kf: {}, ...extra };
}
function clipLabel(c) {
  if (c.kind === 'text') return (c.props.text.split('\n')[0] || 'Napis');
  if (c.kind === 'color') return c.name || 'Plansza';
  if (c.kind === 'shape') return c.name || 'Kształt';
  if (c.kind === 'element') return c.name || 'Element';
  if (c.kind === 'adjust') return c.name || 'Warstwa korekcyjna';
  return c.name || media.get(c.mediaId)?.name || 'Klip';
}

/* ---------------- Klatki kluczowe ---------------- */
const KF_PROPS = ['opacity', 'scale', 'x', 'y', 'rotation', 'volume'];
const smooth = p => p * p * (3 - 2 * p);
/* Wygładzanie ruchu między klatkami kluczowymi */
const EASINGS = {
  smooth,
  linear: p => p,
  in: p => p * p * p,
  out: p => 1 - Math.pow(1 - p, 3),
  hold: () => 0,
  bounce: p => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; },
  elastic: p => (p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
  back: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
};
function kfValue(k, t, ease = 'smooth') {
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  const f = EASINGS[ease] || smooth;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b.t) return a.v + (b.v - a.v) * f((t - a.t) / Math.max(EPS, b.t - a.t));
  }
  return last.v;
}
function pv(c, name, local) {
  const k = c.kf?.[name];
  return k?.length ? kfValue(k, local, c.props.kfEase) : c.props[name];
}
const localAt = (c, t = playhead) => clamp(t - c.start, 0, c.dur);
const snapLocal = c => Math.round(localAt(c) * state.fps) / state.fps;
const hasKf = (c, name) => !!c.kf?.[name]?.length;
function kfIndexAt(c, name, local) {
  const k = c.kf?.[name];
  return k ? k.findIndex(f => Math.abs(f.t - local) < frame() / 2) : -1;
}
function setProp(c, name, v) {
  if (KF_PROPS.includes(name) && hasKf(c, name)) {
    const local = snapLocal(c), k = c.kf[name], i = kfIndexAt(c, name, local);
    if (i >= 0) k[i].v = v;
    else { k.push({ t: local, v }); k.sort((a, b) => a.t - b.t); }
  } else setPath(c.props, name, v);
}
function toggleKf(c, name) {
  if (playhead < c.start - EPS || playhead > clipEnd(c) + EPS) { toast('Ustaw głowicę na tym klipie, żeby dodać klatkę kluczową'); return false; }
  const local = snapLocal(c);
  c.kf ??= {};
  const k = c.kf[name] ??= [];
  const i = kfIndexAt(c, name, local);
  if (i >= 0) {
    const v = pv(c, name, local);
    k.splice(i, 1);
    if (!k.length) { delete c.kf[name]; c.props[name] = v; }
  } else {
    k.push({ t: local, v: k.length ? kfValue(k, local) : c.props[name] });
    k.sort((a, b) => a.t - b.t);
  }
  return true;
}
function splitKf(kf, cut) {
  const L = {}, R = {};
  for (const [n, k] of Object.entries(kf || {})) {
    if (!k.length) continue;
    const v = kfValue(k, cut);
    L[n] = [...k.filter(f => f.t < cut - EPS), { t: cut, v }];
    R[n] = [{ t: 0, v }, ...k.filter(f => f.t > cut + EPS).map(f => ({ t: f.t - cut, v: f.v }))];
  }
  return [L, R];
}
function shiftKf(c, d) { for (const k of Object.values(c.kf || {})) for (const f of k) f.t += d; }
function scaleKf(c, f) { for (const k of Object.values(c.kf || {})) for (const x of k) x.t *= f; }
function kfTimes(c) {
  const s = new Set();
  for (const k of Object.values(c.kf || {})) for (const f of k) if (f.t >= -EPS && f.t <= c.dur + EPS) s.add(Math.round(f.t * 1000) / 1000);
  return [...s];
}

/* ---------------- Historia (cofnij / ponów) ---------------- */
const history = { stack: [], idx: -1 };
function snapshot() {
  return JSON.stringify({ w: state.w, h: state.h, fps: state.fps, bg: state.bg, tracks: state.tracks, clips: state.clips, markers: state.markers, range: state.range, folders: state.folders, mediaFolder: state.mediaFolder });
}
function commit() {
  const snap = snapshot();
  if (history.stack[history.idx] === snap) return;
  history.stack = history.stack.slice(0, history.idx + 1);
  history.stack.push(snap);
  if (history.stack.length > 200) history.stack.shift();
  history.idx = history.stack.length - 1;
  updateUndoBtns();
  scheduleSave();
}
function resetHistory() {
  history.stack = [snapshot()];
  history.idx = 0;
  updateUndoBtns();
}
function restore(snap) {
  Object.assign(state, JSON.parse(snap));
  for (const id of [...sel]) if (!clipById(id)) sel.delete(id);
  gcPlayers();
  applyResolution();
  renderAll();
  scheduleSave();
}
function undo() { if (history.idx > 0) { history.idx--; restore(history.stack[history.idx]); updateUndoBtns(); } }
function redo() { if (history.idx < history.stack.length - 1) { history.idx++; restore(history.stack[history.idx]); updateUndoBtns(); } }
function updateUndoBtns() {
  $('#btnUndo').disabled = history.idx <= 0;
  $('#btnRedo').disabled = history.idx >= history.stack.length - 1;
}

/* ---------------- Baza IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('Brak IndexedDB'));
      const r = indexedDB.open('kadr-studio', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('media', { keyPath: 'id' });
        d.createObjectStore('blobs', { keyPath: 'id' });
      };
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq?.result ?? null);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  get(store, key) { return this.req(store, 'readonly', s => s.get(key)); },
  put(store, val) { return this.req(store, 'readwrite', s => s.put(val)); },
  del(store, key) { return this.req(store, 'readwrite', s => s.delete(key)); },
  all(store) { return this.req(store, 'readonly', s => s.getAll()); },
};

const MEDIA_FIELDS = ['id', 'name', 'kind', 'type', 'duration', 'w', 'h', 'thumb', 'wave', 'peak', 'hasAudio', 'strip', 'stripN', 'stripTw', 'stripTh', 'markIn', 'markOut'];
function mediaMeta(m) {
  const rec = {};
  for (const k of MEDIA_FIELDS) rec[k] = m[k] ?? null;
  return rec;
}
function saveMediaMeta(m) { return Store.putMediaMeta(mediaMeta(m)).catch(err => console.warn(err)); }
function saveBlob(m) { return Store.putBlob(m).catch(err => saveFailed(err)); }

let saveTimer = null, saving = false;
function scheduleSave() {
  if (!Store.ready || !project.id) return;
  setSaveState('Niezapisane zmiany…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 700);
}
async function saveProject() {
  if (!Store.ready || !project.id) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saving = true;
  try {
    await Store.putProject({
      id: project.id, name: project.name, updated: Date.now(), data: snapshot(),
      mediaIds: [...media.keys()], duration: projectEnd(), thumb: projectThumb(),
    });
    try { localStorage.setItem(Store.lastKey(), project.id); } catch { /* bez zapisu */ }
    const d = new Date();
    setSaveState((Store.mode === 'cloud' ? 'Zapisano na koncie ' : 'Zapisano ') + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }));
    Store.retryUploads?.();
  } catch (err) { saveFailed(err); }
  saving = false;
}
function saveFailed(err) {
  console.error(err);
  if (err?.status === 401) { setSaveState('Sesja wygasła — zaloguj się ponownie', true); showAuth?.('Sesja wygasła. Zaloguj się, a zmiany zapiszą się na koncie.'); return; }
  setSaveState(Store.mode === 'cloud' ? 'Brak połączenia z serwerem — ponowię zapis' : 'Błąd zapisu — brak miejsca?', true);
  if (Store.mode === 'cloud') { clearTimeout(saveTimer); saveTimer = setTimeout(saveProject, 5000); }
}
function setSaveState(txt, warn = false) {
  const el = $('#saveState');
  el.textContent = txt;
  el.classList.toggle('warn', warn);
}
function projectThumb() {
  try {
    const c = document.createElement('canvas');
    c.width = 192; c.height = Math.round(192 * state.h / state.w);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  } catch { return null; }
}

function clearSession() {
  if (playing) pause();
  for (const id of [...players.keys()]) dropPlayer(id);
  for (const m of media.values()) { URL.revokeObjectURL(m.url); forgetAudio(m.id); }
  media.clear();
  sel.clear();
  playhead = 0;
  closeSource();
}

async function newProject(opts = {}) {
  await closeRecorder();
  await flushSave();
  clearSession();
  state = newState();
  if (opts.w && opts.h) { state.w = opts.w; state.h = opts.h; }
  project = { id: uid('p'), name: opts.name || 'Nowy projekt' };
  $('#projName').value = project.name;
  applyResolution();
  resetHistory();
  renderBin(); renderAll(); renderPresets(); // gotowe napisy dopasowują się do formatu
  await saveProject();
}

async function loadProject(id) {
  const got = await Store.getProject(id).catch(() => null);
  if (!got) return false;
  const { rec, media: metas } = got;
  await closeRecorder(); // trwające nagranie trafia jeszcze do projektu, w którym je zaczęto
  await flushSave();
  clearSession();
  project = { id: rec.id, name: rec.name };
  $('#projName').value = rec.name;
  state = Object.assign(newState(), JSON.parse(rec.data));
  for (const c of state.clips) fillDefaults(c);
  for (const t of state.tracks) { t.vol ??= 1; t.pan ??= 0; }
  applyResolution();
  resetHistory();
  renderBin(); renderAll();
  let i = 0;
  for (const { meta, hasFile } of metas) {
    i++;
    setSaveState(`Wczytywanie plików ${i}/${metas.length}…`);
    const blob = await Store.getBlob(meta, hasFile).catch(() => null);
    if (!blob) continue;
    const m = { ...meta, blob, url: URL.createObjectURL(blob), loading: false };
    if (m.kind === 'image') {
      try { await loadImage(m); } catch { continue; }
    }
    if (m.strip) loadStripImage(m);
    media.set(m.id, m);
    if (project.id !== rec.id) return false; // w międzyczasie otwarto inny projekt
  }
  const missing = state.clips.filter(c => c.mediaId && !media.has(c.mediaId)).length;
  renderBin(); renderAll();
  ensureProjectFonts();
  renderPresets();
  setSaveState(Store.mode === 'cloud' ? 'Wczytano z konta' : 'Wczytano');
  try { localStorage.setItem(Store.lastKey(), project.id); } catch { /* bez zapisu */ }
  if (missing) toast(`Brakuje plików dla ${missing} klipów — zaimportuj je ponownie.`, 5000);
  return true;
}

async function flushSave() { if (saveTimer) await saveProject(); }

function deleteProject(id) { return Store.deleteProject(id); }

function persistStorage() {
  if (persistStorage.done) return;
  persistStorage.done = true;
  navigator.storage?.persist?.().catch(() => {});
}

/* ---------------- Import mediów ---------------- */
function kindOfFile(f) {
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('image/')) return 'image';
  const ext = f.name.split('.').pop().toLowerCase();
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  return null;
}

async function importFiles(files) {
  ensureAudio();
  persistStorage();
  for (const f of files) {
    if (/\.(srt|vtt)$/i.test(f.name)) { await importSubtitles(f); continue; }
    await importOne(f);
  }
}

async function importOne(f) {
  const kind = kindOfFile(f);
  if (!kind) { toast(`Pominięto „${f.name}” — nieobsługiwany format`); return null; }
  const m = { id: uid('m'), name: f.name, kind, type: f.type, blob: f, url: URL.createObjectURL(f), duration: 0, w: 0, h: 0, loading: true, hasAudio: false };
  media.set(m.id, m);
  if (typeof binFolder !== 'undefined' && binFolder) state.mediaFolder[m.id] = binFolder; // import do otwartego folderu
  renderBin();
  try {
    if (kind === 'video') await probeVideo(m);
    else if (kind === 'audio') await probeAudio(m);
    else await loadImage(m);
  } catch {
    URL.revokeObjectURL(m.url);
    media.delete(m.id);
    renderBin();
    toast(`Nie udało się odczytać „${f.name}” — przeglądarka nie obsługuje tego kodeka`, 5000);
    return null;
  }
  if (m.kind === 'image') m.thumb = await imageThumb(m);
  else await analyzeAudio(m);
  m.markIn = 0;
  m.markOut = m.kind === 'image' ? null : m.duration;
  m.loading = false;
  renderBin();
  saveBlob(m).then(() => saveMediaMeta(m)).then(scheduleSave);
  if (m.kind === 'video') makeStrip(m).then(() => { saveMediaMeta(m); renderLanes(); }).catch(() => {});
  return m;
}

async function importBlob(blob, name) {
  const f = new File([blob], name, { type: blob.type });
  return importOne(f);
}

function realDuration(el) {
  return new Promise(resolve => {
    if (isFinite(el.duration) && el.duration > 0) return resolve(el.duration);
    // pliki z nagrywarek (np. MediaRecorder) nie mają zapisanej długości — wymuszamy jej odczyt
    const done = () => {
      if (isFinite(el.duration)) { el.removeEventListener('durationchange', done); el.currentTime = 0; resolve(el.duration); }
    };
    el.addEventListener('durationchange', done);
    el.currentTime = 1e9;
  });
}
function seekTo(el, t) {
  return new Promise(res => {
    const done = () => { el.removeEventListener('seeked', done); res(); };
    el.addEventListener('seeked', done);
    el.currentTime = t;
    setTimeout(done, 3000);
  });
}

function probeVideo(m) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'auto'; v.muted = true; v.playsInline = true;
    v.onerror = () => reject(new Error('decode'));
    v.onloadedmetadata = async () => {
      m.duration = await realDuration(v);
      if (!v.videoWidth) { m.kind = 'audio'; v.removeAttribute('src'); v.load(); return resolve(); } // plik bez obrazu
      m.w = v.videoWidth; m.h = v.videoHeight;
      await seekTo(v, Math.min(1, m.duration / 3));
      const th = 108, cv = document.createElement('canvas');
      cv.height = th; cv.width = Math.max(1, Math.round(th * m.w / m.h));
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      m.thumb = cv.toDataURL('image/jpeg', 0.75);
      v.removeAttribute('src'); v.load();
      resolve();
    };
    v.src = m.url;
  });
}
function probeAudio(m) {
  return new Promise((resolve, reject) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onerror = () => reject(new Error('decode'));
    a.onloadedmetadata = async () => { m.duration = await realDuration(a); a.removeAttribute('src'); a.load(); resolve(); };
    a.src = m.url;
  });
}
function loadImage(m) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { m.w = img.naturalWidth || 1920; m.h = img.naturalHeight || 1080; m.img = img; m.duration = Infinity; resolve(); };
    img.onerror = () => reject(new Error('decode'));
    img.src = m.url;
  });
}
function imageThumb(m) {
  const th = 108, cv = document.createElement('canvas');
  cv.height = th; cv.width = Math.max(1, Math.round(th * m.w / m.h));
  cv.getContext('2d').drawImage(m.img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.8);
}

async function analyzeAudio(m) {
  if (m.blob.size > 700e6) { m.hasAudio = true; return; } // zbyt duży plik — zakładamy, że ma dźwięk
  try {
    const buf = await ensureAudio().decodeAudioData(await m.blob.arrayBuffer());
    const cols = Math.max(1, Math.min(Math.ceil(buf.duration * 40), 16000));
    const H = 64, cv = document.createElement('canvas');
    cv.width = cols; cv.height = H;
    const g = cv.getContext('2d');
    const chans = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
    const len = chans[0].length, step = len / cols;
    let peak = 0;
    g.fillStyle = 'rgba(255,255,255,.78)';
    for (let i = 0; i < cols; i++) {
      const a = Math.floor(i * step), b = Math.min(len, Math.floor((i + 1) * step));
      const stride = Math.max(1, Math.floor((b - a) / 128));
      let p = 0;
      for (const ch of chans) for (let j = a; j < b; j += stride) { const v = Math.abs(ch[j]); if (v > p) p = v; }
      if (p > peak) peak = p;
      const h = Math.max(1, Math.min(1, p) * (H - 2));
      g.fillRect(i, (H - h) / 2, 1, h);
    }
    m.wave = cv.toDataURL('image/png');
    m.peak = peak;
    m.hasAudio = peak > 0.0005;
  } catch {
    m.hasAudio = false; // brak ścieżki dźwiękowej
  }
}

async function makeStrip(m) {
  const v = document.createElement('video');
  v.preload = 'auto'; v.muted = true; v.src = m.url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
  const n = clamp(Math.ceil(m.duration / 2.5), 6, 48);
  const th = 64, tw = Math.max(8, Math.round(th * m.w / m.h));
  const cv = document.createElement('canvas');
  cv.width = n * tw; cv.height = th;
  const g = cv.getContext('2d');
  for (let i = 0; i < n; i++) {
    await seekTo(v, Math.min(m.duration - 0.05, (i + 0.5) / n * m.duration));
    g.drawImage(v, i * tw, 0, tw, th);
  }
  v.removeAttribute('src'); v.load();
  m.strip = cv.toDataURL('image/jpeg', 0.7);
  m.stripN = n; m.stripTw = tw; m.stripTh = th;
  await loadStripImage(m);
}
function loadStripImage(m) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { m.stripImg = img; res(); renderLanes(); };
    img.onerror = () => res();
    img.src = m.strip;
  });
}

function removeMedia(id) {
  const used = state.clips.filter(c => c.mediaId === id).length;
  const m = media.get(id);
  if (used && !confirm(`Plik „${m.name}” jest użyty w ${used} klipach na osi czasu. Usunąć go razem z nimi?`)) return;
  state.clips = state.clips.filter(c => c.mediaId !== id);
  delete state.mediaFolder[id];
  media.delete(id);
  forgetAudio(id);
  if (srcMediaId === id) closeSource();
  gcPlayers();
  URL.revokeObjectURL(m.url);
  for (const cid of [...sel]) if (!clipById(cid)) sel.delete(cid);
  commit(); renderBin(); renderAll();
  // na koncie serwer sam usuwa pliki, których nie używa żaden projekt (przy zapisie projektu)
  if (Store.mode === 'local') {
    DB.all('projects').then(all => {
      const usedElsewhere = (all || []).some(p => p.id !== project.id && (p.mediaIds || []).includes(id));
      if (!usedElsewhere) { DB.del('media', id); DB.del('blobs', id); }
    }).catch(() => {});
  }
}

/* ---------------- Napisy SRT / VTT ---------------- */
function parseSubs(text) {
  const out = [];
  const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const t = (h, m, s, ms) => (+h || 0) * 3600 + +m * 60 + +s + +ms.padEnd(3, '0') / 1000;
  const src = text.replace(/\r/g, '');
  let m;
  while ((m = re.exec(src))) {
    const body = m[9].replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    if (body) out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: body });
  }
  return out;
}
async function importSubtitles(f) {
  const subs = parseSubs(await f.text());
  if (!subs.length) { toast(`W pliku „${f.name}” nie znaleziono napisów`); return; }
  const tr = mkTrack(uid('t'), 'text', 'Napisy');
  state.tracks.unshift(tr);
  const preset = TITLE_PRESETS.find(p => p.key === 'subs');
  for (const s of subs) {
    const c = newClip('text', tr.id, s.start, Math.max(frame(), s.end - s.start), { name: 'Napis' });
    Object.assign(c.props, preset.p(state.w, state.h), { text: s.text });
    state.clips.push(c);
  }
  commit(); renderAll();
  toast(`Dodano ${subs.length} napisów na ścieżkę „Napisy”`);
}

/* ---------------- Gotowe style napisów i plansz ---------------- */
const TITLE_PRESETS = [
  { key: 'title', name: 'Tytuł główny', dur: 4, p: (W, H) => ({ text: 'TYTUŁ FILMU', font: 'Montserrat', weight: 800, size: Math.round(H * 0.13), spacing: 4, y: 0, inType: 'zoom-out', fadeIn: 0.8, outType: 'fade', fadeOut: 0.6 }) },
  { key: 'sub', name: 'Podtytuł', dur: 4, p: (W, H) => ({ text: 'Krótki opis albo podtytuł', font: 'Inter', weight: 500, size: Math.round(H * 0.055), y: Math.round(H * 0.12), inType: 'slide-d', fadeIn: 0.6, fadeOut: 0.4 }) },
  { key: 'lower', name: 'Belka z nazwiskiem', dur: 5, anchor: 'left', p: (W, H) => ({ text: 'Jan Kowalski\nwłaściciel firmy', font: 'Inter', weight: 700, size: Math.round(H * 0.048), align: 'left', bg: true, bgColor: '#14161c', bgOpacity: 0.88, shadow: false, y: Math.round(H * 0.3), inType: 'slide-l', fadeIn: 0.5, outType: 'slide-l', fadeOut: 0.4 }) },
  { key: 'subs', name: 'Napisy dialogowe', dur: 3, p: (W, H) => ({ text: 'Tak wyglądają napisy pod filmem.', font: 'Inter', weight: 600, size: Math.round(H * 0.045), bg: true, bgColor: '#000000', bgOpacity: 0.55, shadow: false, y: Math.round(H * 0.38), fadeIn: 0, fadeOut: 0 }) },
  { key: 'cine', name: 'Kinowy', dur: 5, p: (W, H) => ({ text: 'Rozdział pierwszy', font: 'Playfair Display', weight: 700, size: Math.round(H * 0.1), spacing: 6, y: 0, fadeIn: 1.5, fadeOut: 1.2, inType: 'blur' }) },
  { key: 'bold', name: 'Krzykliwy', dur: 3, p: (W, H) => ({ text: 'PROMOCJA!', font: 'Bebas Neue', weight: 400, size: Math.round(H * 0.22), color: '#ffd34d', stroke: Math.round(H * 0.006), strokeColor: '#000000', y: 0, inType: 'pop', fadeIn: 0.45, fadeOut: 0.3 }) },
  { key: 'reel', name: 'Napis do rolki', dur: 3, p: (W, H) => ({ text: 'ZOBACZ TO', font: 'Montserrat', weight: 800, size: Math.round(Math.min(W, H) * 0.09), upper: true, stroke: Math.round(Math.min(W, H) * 0.007), strokeColor: '#000000', shadow: true, y: Math.round(H * 0.18), inType: 'pop', fadeIn: 0.3, fadeOut: 0.2 }) },
  { key: 'hand', name: 'Odręczny', dur: 4, p: (W, H) => ({ text: 'Dzięki za oglądanie!', font: 'Permanent Marker', weight: 400, size: Math.round(H * 0.09), rotation: -4, y: 0, inType: 'pop', fadeIn: 0.5, fadeOut: 0.5 }) },
  { key: 'type', name: 'Maszyna do pisania', dur: 5, p: (W, H) => ({ text: 'Poznań, 2026', font: 'JetBrains Mono', weight: 500, size: Math.round(H * 0.06), y: Math.round(H * 0.3), inType: 'type', fadeIn: 1.8, fadeOut: 0.4 }) },
  { key: 'neon', name: 'Neon', dur: 4, p: (W, H) => ({ text: 'NOC W MIEŚCIE', font: 'Montserrat', weight: 800, size: Math.round(H * 0.11), color: '#7df9ff', glow: true, shadow: false, y: 0, inType: 'blur', fadeIn: 0.8, fadeOut: 0.6 }) },
  { key: 'chapter', name: 'Śródtytuł', dur: 3, p: (W, H) => ({ text: 'CZĘŚĆ 2', font: 'Oswald', weight: 500, size: Math.round(H * 0.085), spacing: 10, y: 0, inType: 'wipe', fadeIn: 0.6, outType: 'fade', fadeOut: 0.4 }) },
  { key: 'quote', name: 'Cytat', dur: 5, p: (W, H) => ({ text: '„Najlepsza robota\nto dobrze zrobiona robota.”', font: 'Playfair Display', weight: 700, italic: false, size: Math.round(H * 0.065), lineHeight: 1.3, y: 0, fadeIn: 0.8, fadeOut: 0.8 }) },
];
const SOLID_PRESETS = [
  { key: 'black', name: 'Czerń', p: { grad: 'solid', c1: '#000000', c2: '#000000' } },
  { key: 'white', name: 'Biel', p: { grad: 'solid', c1: '#ffffff', c2: '#ffffff' } },
  { key: 'graphite', name: 'Grafit', p: { grad: 'radial', c1: '#3a4256', c2: '#0b0c10' } },
  { key: 'sunset', name: 'Zachód', p: { grad: 'linear', c1: '#ff7e5f', c2: '#feb47b', angle: 135 } },
  { key: 'ocean', name: 'Ocean', p: { grad: 'linear', c1: '#1d6fa3', c2: '#6dd5ed', angle: 135 } },
  { key: 'violet', name: 'Fiolet', p: { grad: 'linear', c1: '#41295a', c2: '#2f0743', angle: 160 } },
  { key: 'berry', name: 'Malina', p: { grad: 'linear', c1: '#c0396b', c2: '#1b2a6b', angle: 135 } },
  { key: 'forest', name: 'Las', p: { grad: 'linear', c1: '#134e5e', c2: '#71b280', angle: 135 } },
  { key: 'brand', name: 'Granat', p: { grad: 'radial', c1: '#24408e', c2: '#0a1230' } },
];
const LOOKS = [
  { key: 'none', name: 'Bez filtra', fx: {} },
  { key: 'warm', name: 'Ciepły', fx: { temp: 35, saturate: 110 } },
  { key: 'cool', name: 'Chłodny', fx: { temp: -35, saturate: 95 } },
  { key: 'vivid', name: 'Żywy', fx: { saturate: 145, contrast: 110 } },
  { key: 'cine', name: 'Kinowy', fx: { contrast: 115, saturate: 85, temp: -10, vignette: 35 } },
  { key: 'vintage', name: 'Vintage', fx: { sepia: 35, contrast: 90, saturate: 80, brightness: 105, vignette: 40 } },
  { key: 'faded', name: 'Wyblakły', fx: { contrast: 80, brightness: 110, saturate: 70 } },
  { key: 'bw', name: 'Czarno-biały', fx: { grayscale: 100, contrast: 115 } },
  { key: 'noir', name: 'Noir', fx: { grayscale: 100, contrast: 150, brightness: 95, vignette: 60 } },
];
// kroje używane w gotowych stylach — ładowane od razu ze strony głównej
const FONTS = ['Inter', 'Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Permanent Marker', 'JetBrains Mono'];
