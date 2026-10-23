'use strict';
/* assets.js — biblioteka assetów: kształty, elementy, nakładki, tła, dźwięki, szablony, LUT i „Moje assety” */

/* ---------------- Pomocnicze: gdzie położyć nowy klip ---------------- */
function topFreeVideoTrack(t, dur) {
  for (const tr of state.tracks) {
    if (tr.kind !== 'video' || tr.locked) continue;
    if (!overlaps(tr.id, t, t + dur)) return tr;
  }
  return addTrack('video', false);
}
function addVisualClip(kind, patch, { t = playhead, dur = 5, trackId = null, name = '' } = {}) {
  t = Math.max(0, t);
  let tr = trackId ? state.tracks.find(x => x.id === trackId && x.kind === 'video' && !x.locked) : null;
  tr ||= topFreeVideoTrack(t, dur);
  clearRange(tr.id, t, t + dur);
  const c = newClip(kind, tr.id, t, dur, { name });
  Object.assign(c.props, structuredClone(patch || {}));
  state.clips.push(c);
  return c;
}

/* ---------------- Definicje assetów ---------------- */
const SHAPE_DEFS = [
  ['roundrect', 'Prostokąt zaokrąglony', { w: 560, h: 320, corner: 36 }], ['rect', 'Prostokąt', { w: 560, h: 320 }],
  ['circle', 'Koło', { w: 360, h: 360 }], ['ring', 'Pierścień', { w: 360, h: 360, fill: '#ffd34d' }],
  ['triangle', 'Trójkąt', { w: 380, h: 330 }], ['star', 'Gwiazda', { w: 380, h: 380, fill: '#ffd34d' }],
  ['arrow', 'Strzałka', { w: 520, h: 220, fill: '#ff4d5e' }], ['heart', 'Serce', { w: 360, h: 330, fill: '#ff4d6d' }],
  ['callout', 'Dymek', { w: 600, h: 300, corner: 40, fill: '#ffffff' }], ['line', 'Linia', { w: 700, h: 40, strokeW: 10, fill: '#ffffff' }],
];
const ELEMENT_DEFS = [
  ['progress', 'Pasek postępu', { y: 0, barH: 14 }, 'elements', 10],
  ['countdown', 'Odliczanie', { count: 5, color: '#6b95ff' }, 'elements', 5],
  ['timer', 'Stoper', {}, 'elements', 10],
  ['subscribe', 'Przycisk Subskrybuj', { color: '#e62117' }, 'elements', 4],
  ['rec', 'Kamera REC', { color2: '#ffffff' }, 'overlays', 8],
  ['lightleak', 'Prześwietlenie (light leak)', { color: '#ff9a3c', opacity: 0.8, blend: 'screen' }, 'overlays', 6],
  ['grain', 'Ziarno filmowe', { opacity: 0.35 }, 'overlays', 10],
  ['letterbox', 'Pasy kinowe 2,39:1', { color: '#000000', ratio: 2.39 }, 'overlays', 10],
  ['confetti', 'Konfetti', {}, 'overlays', 5],
  ['snow', 'Śnieg', { color2: '#ffffff' }, 'overlays', 8],
  ['bokeh', 'Bokeh (światła)', { opacity: 0.85 }, 'overlays', 8],
  ['bg-gradient', 'Gradient animowany', { color: '#24408e', color2: '#c0396b' }, 'backgrounds', 6],
  ['bg-dots', 'Kropki', { color: '#15171c', color2: '#6b95ff' }, 'backgrounds', 6],
  ['bg-grid', 'Siatka', { color: '#101217', color2: '#5fd39b' }, 'backgrounds', 6],
  ['bg-stripes', 'Paski', { color: '#1b1d27', color2: '#ffd34d' }, 'backgrounds', 6],
];
const SFX_DEFS = [
  ['whoosh', 'Świst (whoosh)'], ['riser', 'Narastanie (riser)'], ['impact', 'Uderzenie'], ['bassdrop', 'Bass drop'],
  ['pop', 'Pyk'], ['click', 'Klik'], ['ding', 'Dzwonek'], ['notify', 'Powiadomienie'], ['coin', 'Moneta'],
  ['typing', 'Pisanie na klawiaturze'], ['shutter', 'Migawka aparatu'], ['heartbeat', 'Bicie serca'],
  ['applause', 'Brawa'], ['glitch', 'Zakłócenia'], ['error', 'Błąd'], ['tada', 'Ta-da!'],
];
const TEMPLATE_DEFS = [
  { id: 'intro', name: 'Intro z tytułem', dur: 5, desc: 'Tło, tytuł i prześwietlenie' },
  { id: 'outro', name: 'Outro z subskrypcją', dur: 6, desc: 'Plansza, podziękowanie i przycisk' },
  { id: 'count', name: 'Odliczanie startowe', dur: 5, desc: 'Odliczanie 5–1 na tle' },
  { id: 'news', name: 'Wiadomości / belka', dur: 6, desc: 'Belka z nazwiskiem i paskiem' },
  { id: 'cine', name: 'Look kinowy', dur: 10, desc: 'Pasy, ziarno i warstwa koloru' },
];
const ASSET_CATS = [['all', 'Wszystko'], ['shapes', 'Kształty'], ['elements', 'Elementy'], ['overlays', 'Nakładki'], ['backgrounds', 'Tła'], ['sounds', 'Dźwięki'], ['templates', 'Szablony'], ['luts', 'LUT'], ['mine', 'Moje']];

function assetCatalog() {
  const out = [];
  for (const [shape, name, patch] of SHAPE_DEFS) out.push({ id: 'shape:' + shape, cat: 'shapes', name, prev: `<div class="ap-shape ap-${shape}"></div>` });
  for (const [el, name, , cat] of ELEMENT_DEFS) out.push({ id: 'el:' + el, cat, name, prev: `<div class="ap-el ap-${el}"></div>` });
  out.push({ id: 'adjust', cat: 'overlays', name: 'Warstwa korekcyjna', prev: '<div class="ap-el ap-adjust"></div>' });
  for (const p of SOLID_PRESETS) {
    const g = p.p.grad === 'solid' ? p.p.c1 : p.p.grad === 'radial' ? `radial-gradient(circle, ${p.p.c1}, ${p.p.c2})` : `linear-gradient(${p.p.angle}deg, ${p.p.c1}, ${p.p.c2})`;
    out.push({ id: 'solid:' + p.key, cat: 'backgrounds', name: 'Plansza: ' + p.name, prev: `<div style="position:absolute;inset:0;background:${g}"></div>` });
  }
  for (const [s, name] of SFX_DEFS) out.push({ id: 'sfx:' + s, cat: 'sounds', name, prev: `<div class="ap-sfx"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg></div>`, sound: true });
  for (const t of TEMPLATE_DEFS) out.push({ id: 'tpl:' + t.id, cat: 'templates', name: t.name, desc: t.desc, prev: `<div class="ap-tpl ap-tpl-${t.id}"><span>${esc(t.name)}</span></div>` });
  for (const l of BUILTIN_LUTS) out.push({ id: 'lut:b:' + l.id, cat: 'luts', name: l.name, prev: `<div class="ap-lut" style="background:${l.css}"></div>` });
  out.push({ id: 'lut-import', cat: 'luts', name: 'Importuj LUT (.cube)', prev: '<div class="ap-sfx"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 21h14"/></svg></div>' });
  for (const a of userAssets) out.push({ id: 'my:' + a.id, cat: 'mine', name: a.name, fav: a.fav, prev: myAssetPreview(a), my: a });
  return out;
}
function assetLaneKind(id) {
  if (id.startsWith('sfx:')) return 'audio';
  if (id.startsWith('my:')) { const a = userAssets.find(x => 'my:' + x.id === id); return a?.kind === 'text-style' || a?.data?.clip?.kind === 'text' ? 'text' : a?.kind === 'media' && a.data?.kind === 'audio' ? 'audio' : 'video'; }
  return 'video';
}

/* ---------------- Użycie assetu ---------------- */
async function useAsset(id, t = playhead, trackId = null) {
  try {
    if (id.startsWith('shape:')) {
      const def = SHAPE_DEFS.find(d => d[0] === id.slice(6));
      const c = addVisualClip('shape', { shape: def[0], ...def[2] }, { t, trackId, name: def[1] });
      done([c]);
    } else if (id.startsWith('el:')) {
      const def = ELEMENT_DEFS.find(d => d[0] === id.slice(3));
      const patch = { el: def[0], ...def[2] };
      if (def[0] === 'progress') patch.y = Math.round(state.h / 2 - 7);
      if (def[0] === 'subscribe') patch.y = Math.round(state.h * 0.3);
      const c = addVisualClip('element', patch, { t, dur: def[4], trackId, name: def[1] });
      done([c]);
    } else if (id === 'adjust') {
      const c = addVisualClip('adjust', { fx: { ...FX0, contrast: 112, saturate: 115 } }, { t, dur: Math.max(5, projectEnd() - t), trackId, name: 'Warstwa korekcyjna' });
      done([c]);
      toast('Warstwa korekcyjna zmienia kolor wszystkiego pod nią — ustaw filtry we Właściwościach');
    } else if (id.startsWith('solid:')) {
      // plansza idzie na wolną ścieżkę — nie nadpisuje materiału na V1
      const pr = SOLID_PRESETS.find(p => p.key === id.slice(6));
      done([addVisualClip('color', pr.p, { t, trackId, name: pr.name })]);
    } else if (id.startsWith('sfx:')) {
      await placeSfx(id.slice(4), t, trackId);
    } else if (id.startsWith('tpl:')) {
      applyTemplate(id.slice(4), t);
    } else if (id.startsWith('lut:b:')) {
      applyLut('b:' + id.slice(6));
    } else if (id === 'lut-import') {
      $('#lutInput').click();
    } else if (id.startsWith('my:')) {
      await useMyAsset(userAssets.find(a => 'my:' + a.id === id), t, trackId);
    }
  } catch (err) {
    console.error(err);
    toast('Nie udało się użyć assetu: ' + err.message);
  }
}
function done(clips) {
  sel = new Set(clips.map(c => c.id));
  commit(); renderAll();
}

/* ---------------- Szablony ---------------- */
function applyTemplate(id, t) {
  const W = state.w, H = state.h;
  const tpl = TEMPLATE_DEFS.find(x => x.id === id);
  const d = tpl.dur;
  const made = [];
  const title = (preset, patch) => {
    const tr = state.tracks.find(x => x.kind === 'text' && !x.locked && !overlaps(x.id, t, t + d)) || addTrack('text', false);
    const pr = TITLE_PRESETS.find(p => p.key === preset);
    const c = newClip('text', tr.id, t, d, { name: pr.name });
    Object.assign(c.props, pr.p(W, H), patch || {});
    if (pr.anchor === 'left') c.props.x = Math.round(-W / 2 + W * 0.06 + textLayout(c.props).w / 2);
    state.clips.push(c);
    made.push(c);
    return c;
  };
  if (id === 'intro') {
    made.push(addVisualClip('element', { el: 'bg-gradient', color: '#1d2b64', color2: '#c0396b' }, { t, dur: d, name: 'Tło intro' }));
    made.push(addVisualClip('element', { el: 'lightleak', color: '#ff9a3c', opacity: 0.7, blend: 'screen' }, { t, dur: d, name: 'Prześwietlenie' }));
    title('title', { text: project.name.toUpperCase() || 'TYTUŁ FILMU' });
  } else if (id === 'outro') {
    made.push(addVisualClip('color', { grad: 'radial', c1: '#3a4256', c2: '#0b0c10' }, { t, dur: d, name: 'Tło outro' }));
    title('sub', { text: 'Dzięki za obejrzenie!', size: Math.round(H * 0.075), weight: 700, y: Math.round(-H * 0.12) });
    made.push(addVisualClip('element', { el: 'subscribe', color: '#e62117', y: Math.round(H * 0.12) }, { t: t + 0.6, dur: d - 0.6, name: 'Subskrybuj' }));
  } else if (id === 'count') {
    made.push(addVisualClip('element', { el: 'bg-grid', color: '#101217', color2: '#6b95ff' }, { t, dur: d, name: 'Tło' }));
    made.push(addVisualClip('element', { el: 'countdown', count: 5, color: '#6b95ff' }, { t, dur: d, name: 'Odliczanie' }));
  } else if (id === 'news') {
    title('lower', { text: 'Jan Kowalski\nreporter, Poznań', bgColor: '#b00020' });
    made.push(addVisualClip('element', { el: 'progress', color: '#b00020', color2: '#ffffff', barH: 10, y: Math.round(H / 2 - 5) }, { t, dur: d, name: 'Pasek' }));
  } else if (id === 'cine') {
    const dd = Math.max(d, projectEnd() - t);
    made.push(addVisualClip('adjust', { fx: { ...FX0, contrast: 115, saturate: 85, temp: -10 }, lut: { id: 'b:teal', amount: 70 } }, { t, dur: dd, name: 'Kolor kinowy' }));
    made.push(addVisualClip('element', { el: 'grain', opacity: 0.25 }, { t, dur: dd, name: 'Ziarno' }));
    made.push(addVisualClip('element', { el: 'letterbox', color: '#000000', ratio: 2.39 }, { t, dur: dd, name: 'Pasy kinowe' }));
  }
  done(made);
  toast(`Wstawiono szablon „${tpl.name}” — każdy element możesz edytować osobno`);
}

/* ---------------- Efekty dźwiękowe z syntezatora ---------------- */
async function synthSfx(kind) {
  const sr = 44100;
  const durs = { whoosh: 1, riser: 2.5, impact: 1.6, bassdrop: 1.8, pop: 0.2, click: 0.08, ding: 1.8, notify: 0.7, coin: 0.5, typing: 1.6, shutter: 0.35, heartbeat: 2.6, applause: 3.5, glitch: 0.8, error: 0.5, tada: 1.6 };
  const dur = durs[kind] || 1;
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const out = ac.createGain(); out.gain.value = 0.8; out.connect(ac.destination);
  const noise = (len = dur) => {
    const b = ac.createBuffer(1, Math.ceil(sr * len), sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = b; return s;
  };
  const env = (g, t0, a, peak, r) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + r); };
  const tone = (type, f0, f1, t0, len, peak = 0.5, a = 0.005) => {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    env(g, t0, a, peak, len); o.connect(g).connect(out); o.start(t0); o.stop(t0 + a + len + 0.05);
  };
  switch (kind) {
    case 'whoosh': { const n = noise(), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(3500, 0.45); f.frequency.exponentialRampToValueAtTime(600, 0.95); env(g, 0, 0.4, 0.9, 0.55); n.connect(f).connect(g).connect(out); n.start(); break; }
    case 'riser': { const n = noise(), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'highpass'; f.frequency.setValueAtTime(200, 0); f.frequency.exponentialRampToValueAtTime(7000, 2.4); g.gain.setValueAtTime(0.01, 0); g.gain.exponentialRampToValueAtTime(0.7, 2.4); g.gain.linearRampToValueAtTime(0, 2.5); n.connect(f).connect(g).connect(out); n.start(); tone('sawtooth', 110, 880, 0, 2.4, 0.15, 2.2); break; }
    case 'impact': { tone('sine', 90, 32, 0, 1.4, 1, 0.003); const n = noise(0.4), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'lowpass'; f.frequency.value = 1800; env(g, 0, 0.002, 0.8, 0.35); n.connect(f).connect(g).connect(out); n.start(); break; }
    case 'bassdrop': { const o = ac.createOscillator(), ws = ac.createWaveShaper(), g = ac.createGain(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(3 * x); } ws.curve = curve; o.frequency.setValueAtTime(160, 0); o.frequency.exponentialRampToValueAtTime(38, 1.6); env(g, 0, 0.01, 0.9, 1.7); o.connect(ws).connect(g).connect(out); o.start(); o.stop(1.8); break; }
    case 'pop': tone('sine', 1000, 280, 0, 0.14, 0.8, 0.002); break;
    case 'click': { const n = noise(0.05), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'highpass'; f.frequency.value = 2500; env(g, 0, 0.001, 0.9, 0.03); n.connect(f).connect(g).connect(out); n.start(); break; }
    case 'ding': for (const [f, a] of [[1320, 0.45], [2640, 0.2], [3960, 0.1]]) tone('sine', f, f, 0, 1.7, a, 0.003); break;
    case 'notify': tone('sine', 880, 880, 0, 0.25, 0.5); tone('sine', 1320, 1320, 0.18, 0.45, 0.5); break;
    case 'coin': tone('square', 988, 988, 0, 0.08, 0.25); tone('square', 1319, 1319, 0.08, 0.38, 0.25); break;
    case 'typing': { let t = 0.02; while (t < 1.5) { const n = noise(0.04), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'bandpass'; f.frequency.value = 2000 + Math.random() * 2500; env(g, t, 0.001, 0.6, 0.03); n.connect(f).connect(g).connect(out); n.start(t); t += 0.06 + Math.random() * 0.12; } break; }
    case 'shutter': for (const t0 of [0, 0.11]) { const n = noise(0.08), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'bandpass'; f.frequency.value = 3200; env(g, t0, 0.001, 0.9, 0.06); n.connect(f).connect(g).connect(out); n.start(t0); } break;
    case 'heartbeat': for (let b = 0; b < 3; b++) { tone('sine', 62, 40, b * 0.85, 0.16, 0.95, 0.004); tone('sine', 58, 38, b * 0.85 + 0.22, 0.16, 0.75, 0.004); } break;
    case 'applause': { const n = noise(), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.6; g.gain.setValueAtTime(0, 0); for (let t = 0; t < 3.4; t += 0.03) g.gain.setValueAtTime((0.25 + Math.random() * 0.45) * Math.min(1, t * 2) * Math.min(1, (3.5 - t) * 0.8), t); n.connect(f).connect(g).connect(out); n.start(); break; }
    case 'glitch': { let t = 0; while (t < 0.75) { const len = 0.03 + Math.random() * 0.06; tone('square', 80 + Math.random() * 1600, 80 + Math.random() * 1600, t, len, 0.25, 0.001); t += len; } break; }
    case 'error': tone('sawtooth', 110, 105, 0, 0.18, 0.4); tone('sawtooth', 98, 92, 0.22, 0.22, 0.4); break;
    case 'tada': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, i * 0.09, 1.2 - i * 0.09, 0.3, 0.004)); break;
  }
  return ac.startRendering();
}
const sfxCache = new Map();
async function placeSfx(kind, t, trackId) {
  const name = (SFX_DEFS.find(s => s[0] === kind)?.[1] || kind) + '.wav';
  let m = [...media.values()].find(x => x.name === name && x.kind === 'audio');
  if (!m) {
    toast('Tworzę dźwięk…', 1000);
    const buf = await synthSfx(kind);
    m = await importBlob(encodeWav(buf, 16), name);
    if (!m) return;
  }
  let tr = trackId ? state.tracks.find(x => x.id === trackId && x.kind === 'audio' && !x.locked) : null;
  tr ||= state.tracks.find(x => x.kind === 'audio' && !x.locked && !overlaps(x.id, t, t + m.duration)) || addTrack('audio', false);
  placeMedia(m, { t, trackId: tr.id });
}
let sfxPreview = null;
async function previewSfx(kind) {
  ensureAudio();
  await audioCtx.resume();
  if (!sfxCache.has(kind)) sfxCache.set(kind, await synthSfx(kind));
  sfxPreview?.stop();
  const s = audioCtx.createBufferSource();
  s.buffer = sfxCache.get(kind);
  s.connect(audioCtx.destination);
  s.start();
  sfxPreview = s;
}

/* ---------------- LUT ---------------- */
const BUILTIN_LUTS = [
  { id: 'teal', name: 'Teal & Orange', css: 'linear-gradient(135deg,#0d6e74,#f39a4b)' },
  { id: 'warm', name: 'Ciepły film', css: 'linear-gradient(135deg,#5b3a1f,#f6c27a)' },
  { id: 'cold', name: 'Zimny błękit', css: 'linear-gradient(135deg,#0d2340,#9ec9ff)' },
  { id: 'bleach', name: 'Bleach bypass', css: 'linear-gradient(135deg,#333,#cfd2c6)' },
  { id: 'cross', name: 'Cross process', css: 'linear-gradient(135deg,#1c4d2a,#f2f07a)' },
  { id: 'fade', name: 'Wyblakły vintage', css: 'linear-gradient(135deg,#4b4250,#e7d7c0)' },
  { id: 'noir', name: 'Noir kontrast', css: 'linear-gradient(135deg,#000,#fff)' },
  { id: 'pop', name: 'Żywe kolory', css: 'linear-gradient(135deg,#ff2d7a,#2de0ff)' },
];
function lutFn(id) {
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = (r, g, b, s) => { const l = lum(r, g, b); return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s]; };
  const curve = (x, k) => 1 / (1 + Math.exp(-k * (x - 0.5)));
  const sc = (x, k) => (curve(x, k) - curve(0, k)) / (curve(1, k) - curve(0, k));
  return {
    teal: (r, g, b) => { const l = lum(r, g, b), sh = 1 - l, hi = l; return sat(r + 0.1 * hi - 0.06 * sh, g + 0.02 * hi + 0.02 * sh, b - 0.08 * hi + 0.1 * sh, 1.15).map(v => sc(v, 6)); },
    warm: (r, g, b) => sat(r * 1.06 + 0.04, g * 1.01 + 0.03, b * 0.88 + 0.04, 0.95).map(v => sc(v, 5)),
    cold: (r, g, b) => sat(r * 0.9, g * 0.98 + 0.01, b * 1.1 + 0.03, 0.9).map(v => sc(v, 5.5)),
    bleach: (r, g, b) => sat(r, g, b, 0.45).map(v => sc(v, 8)),
    cross: (r, g, b) => [sc(r, 7), sc(g, 5) * 1.03, b * 0.75 + 0.12],
    fade: (r, g, b) => sat(r, g, b, 0.7).map(v => 0.08 + v * 0.86),
    noir: (r, g, b) => { const l = sc(lum(r, g, b), 10); return [l, l, l]; },
    pop: (r, g, b) => sat(r, g, b, 1.5).map(v => sc(v, 5.5)),
  }[id];
}
const lutCache = new Map(); // id -> { size, data: Float32Array (r,g,b) }
function getLut(id) {
  if (lutCache.has(id)) return lutCache.get(id);
  if (id.startsWith('b:')) {
    const f = lutFn(id.slice(2));
    if (!f) return null;
    const N = 17, data = new Float32Array(N * N * N * 3);
    let i = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const o = f(r / (N - 1), g / (N - 1), b / (N - 1));
      data[i++] = clamp(o[0], 0, 1); data[i++] = clamp(o[1], 0, 1); data[i++] = clamp(o[2], 0, 1);
    }
    const lut = { size: N, data };
    lutCache.set(id, lut);
    return lut;
  }
  if (id.startsWith('u:')) {
    const a = userAssets.find(x => x.id === id.slice(2));
    if (!a?.data?.table) return null;
    const lut = { size: a.data.size, data: Float32Array.from(a.data.table) };
    lutCache.set(id, lut);
    return lut;
  }
  return null;
}
function lutName(id) {
  if (!id) return '';
  if (id.startsWith('b:')) return BUILTIN_LUTS.find(l => l.id === id.slice(2))?.name || id;
  return userAssets.find(x => x.id === id.slice(2))?.name || 'LUT';
}
function applyLut(id) {
  const targets = selectedClips().filter(c => ['video', 'image', 'adjust'].includes(c.kind));
  if (!targets.length) { toast('Zaznacz klip wideo, zdjęcie albo warstwę korekcyjną — LUT nadaje im kolor'); return; }
  for (const c of targets) c.props.lut = { id, amount: c.props.lut?.amount ?? 100 };
  commit(); renderAll();
  toast(`LUT „${lutName(id)}” na ${targets.length} ${targets.length === 1 ? 'klipie' : 'klipach'}`);
}
function parseCube(text) {
  let size = 0;
  const table = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const m = s.match(/^LUT_3D_SIZE\s+(\d+)/i);
    if (m) { size = +m[1]; continue; }
    if (/^[A-Z_]/i.test(s)) continue; // TITLE, DOMAIN_MIN itd.
    const v = s.split(/\s+/).map(Number);
    if (v.length >= 3 && v.every(Number.isFinite)) table.push(+v[0].toFixed(4), +v[1].toFixed(4), +v[2].toFixed(4));
  }
  if (!size || table.length !== size * size * size * 3) throw new Error('to nie jest poprawny plik LUT 3D (.cube)');
  if (size > 65) throw new Error('LUT jest za duży (maks. 65³)');
  return { size, table };
}
$('#lutInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const lut = parseCube(await f.text());
    const a = { id: uid('a'), kind: 'lut', name: f.name.replace(/\.cube$/i, ''), data: lut, fav: false };
    await Store.putAsset(a);
    await loadUserAssets();
    toast(`Zaimportowano LUT „${a.name}” (${lut.size}³) — jest w kategorii LUT i „Moje”`);
    if (selectedClips().some(c => ['video', 'image', 'adjust'].includes(c.kind))) applyLut('u:' + a.id);
  } catch (err) { toast('Nie udało się wczytać LUT: ' + err.message, 5000); }
});

/* ---------------- Moje assety (baza na koncie) ---------------- */
let userAssets = [];
async function loadUserAssets() {
  try { userAssets = (await Store.listAssets()) || []; } catch { userAssets = []; }
  for (const k of [...lutCache.keys()]) if (k.startsWith('u:')) lutCache.delete(k); // zaimportowane LUT-y wczytają się na nowo
  renderAssets();
}
function myAssetPreview(a) {
  if (a.kind === 'lut') return '<div class="ap-lut" style="background:linear-gradient(135deg,#222,#6b95ff,#ffd34d)"></div>';
  if (a.kind === 'look') return '<div class="ap-lut" style="background:linear-gradient(135deg,#3a2a1a,#d9a05b)"></div>';
  if (a.kind === 'media' && a.data?.thumb) return `<div style="position:absolute;inset:0;background:center/cover url('${a.data.thumb}')"></div>`;
  if (a.kind === 'media' && a.data?.wave) return `<div style="position:absolute;inset:0;background:#0f2a20 center/100% 70% no-repeat url('${a.data.wave}')"></div>`;
  const c = a.data?.clip;
  if (c?.kind === 'text') return `<div class="ap-text" style="font-family:'${esc(c.props.font)}',sans-serif;color:${c.props.color};font-weight:${c.props.weight}">${esc(String(c.props.text).split('\n')[0]).slice(0, 18)}</div>`;
  return `<div class="ap-sfx"><svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg></div>`;
}
async function saveClipAsAsset(c) {
  if (!c) return;
  const name = await ask('Nazwa assetu', clipLabel(c), { ok: 'Zapisz' });
  if (!name?.trim()) return;
  if (c.mediaId) { const m = media.get(c.mediaId); if (m) await saveMediaAsAsset(m, name.trim()); return; }
  const clip = structuredClone(c);
  delete clip.id; delete clip.group; delete clip.trackId;
  await Store.putAsset({ id: uid('a'), kind: 'clip', name: name.trim(), data: { clip }, fav: false });
  await loadUserAssets();
  toast(`Zapisano „${name.trim()}” w „Moich assetach”${Store.mode === 'cloud' ? ' na koncie' : ''}`);
}
async function saveLookAsAsset(c) {
  const name = await ask('Nazwa zestawu kolorów', 'Mój look', { ok: 'Zapisz' });
  if (!name?.trim()) return;
  await Store.putAsset({ id: uid('a'), kind: 'look', name: name.trim(), data: { fx: c.props.fx, lut: c.props.lut }, fav: false });
  await loadUserAssets();
  toast('Zapisano zestaw kolorów — kliknij go w „Moje”, żeby nałożyć na zaznaczone klipy');
}
async function saveMediaAsAsset(m, name = m.name) {
  toast('Zapisuję plik w bibliotece…', 1500);
  const meta = mediaMeta(m);
  await Store.putAsset({ id: uid('a'), kind: 'media', name, data: { ...meta, id: undefined }, fav: false }, m.blob);
  await loadUserAssets();
  toast(`„${name}” jest w „Moich assetach” — użyjesz go w każdym projekcie`);
}
async function useMyAsset(a, t, trackId) {
  if (!a) return;
  if (a.kind === 'lut') { applyLut('u:' + a.id); return; }
  if (a.kind === 'look') {
    const targets = selectedClips().filter(c => c.props.fx);
    if (!targets.length) { toast('Zaznacz klipy, na które nałożyć ten zestaw kolorów'); return; }
    for (const c of targets) { c.props.fx = { ...FX0, ...a.data.fx }; if (a.data.lut) c.props.lut = { ...a.data.lut }; }
    commit(); renderAll();
    return;
  }
  if (a.kind === 'clip') {
    const c = structuredClone(a.data.clip);
    c.id = uid('c');
    const lk = laneKind(c.kind);
    let tr = trackId ? state.tracks.find(x => x.id === trackId && x.kind === lk && !x.locked) : null;
    tr ||= lk === 'video' ? topFreeVideoTrack(t, c.dur) : state.tracks.find(x => x.kind === lk && !x.locked && !overlaps(x.id, t, t + c.dur)) || addTrack(lk, false);
    c.trackId = tr.id; c.start = t;
    clearRange(tr.id, t, t + c.dur);
    state.clips.push(c);
    if (c.kind === 'text') ensureFont(c.props.font);
    done([c]);
    return;
  }
  if (a.kind === 'media') {
    const blob = await Store.assetBlob(a);
    if (!blob) { toast('Brak pliku tego assetu'); return; }
    const m = await importBlob(blob, a.name);
    if (m) placeMedia(m, { t, trackId });
  }
}
async function toggleFav(a) { a.fav = !a.fav; await Store.putAsset(a); await loadUserAssets(); }
async function deleteMyAsset(a) {
  if (!confirm(`Usunąć „${a.name}” z „Moich assetów”?`)) return;
  await Store.deleteAsset(a.id);
  lutCache.delete('u:' + a.id);
  await loadUserAssets();
}

/* ---------------- Zakładka „Assety” ---------------- */
let assetCat = 'all';
function renderAssets() {
  $('#assetCats').innerHTML = ASSET_CATS.map(([k, l]) => `<button type="button" class="chip${assetCat === k ? ' on' : ''}" data-acat="${k}" aria-pressed="${assetCat === k}">${l}</button>`).join('');
  const q = $('#assetSearch').value.trim().toLowerCase();
  const all = assetCatalog().filter(a => (assetCat === 'all' || a.cat === assetCat) && (!q || a.name.toLowerCase().includes(q)));
  const cats = assetCat === 'all' ? ASSET_CATS.slice(1).map(c => c[0]) : [assetCat];
  const html = cats.map(cat => {
    const items = all.filter(a => a.cat === cat);
    if (!items.length) return cat === 'mine' && assetCat === 'mine' ? '<p class="panel-hint">Tu trafiają Twoje zapisane assety: style napisów, zestawy kolorów, pliki i LUT. Prawy przycisk na klipie → „Zapisz jako asset”.</p>' : '';
    return `<h3 class="bin-h">${ASSET_CATS.find(c => c[0] === cat)[1]}</h3><div class="preset-grid">${items.map(a => `<div class="p-card a-card" draggable="true" data-asset="${esc(a.id)}" tabindex="0" role="button" title="${esc(a.desc || a.name)} — kliknij albo przeciągnij na oś">
        <div class="p-prev a-prev">${a.prev}${a.sound ? `<button type="button" class="a-play" data-play="${esc(a.id)}" aria-label="Odsłuchaj ${esc(a.name)}" title="Odsłuchaj">▶</button>` : ''}${a.my ? `<button type="button" class="a-fav${a.fav ? ' on' : ''}" data-fav="${a.my.id}" aria-label="Ulubiony" title="Ulubiony">★</button><button type="button" class="a-del" data-mydel="${a.my.id}" aria-label="Usuń ${esc(a.name)}" title="Usuń">${ICON.x}</button>` : ''}</div>
        <span class="p-name">${esc(a.name)}</span></div>`).join('')}</div>`;
  }).join('');
  $('#assetList').innerHTML = html || '<p class="panel-hint">Nic nie pasuje do wyszukiwania.</p>';
}
$('#assetSearch').addEventListener('input', renderAssets);
$('#assetCats').addEventListener('click', e => {
  const b = e.target.closest('[data-acat]');
  if (b) { assetCat = b.dataset.acat; renderAssets(); }
});
$('#assetList').addEventListener('click', e => {
  const play = e.target.closest('[data-play]');
  if (play) { e.stopPropagation(); previewSfx(play.dataset.play.slice(4)); return; }
  const fav = e.target.closest('[data-fav]');
  if (fav) { e.stopPropagation(); toggleFav(userAssets.find(a => a.id === fav.dataset.fav)); return; }
  const del = e.target.closest('[data-mydel]');
  if (del) { e.stopPropagation(); deleteMyAsset(userAssets.find(a => a.id === del.dataset.mydel)); return; }
  const card = e.target.closest('[data-asset]');
  if (card) useAsset(card.dataset.asset);
});
$('#assetList').addEventListener('keydown', e => {
  const card = e.target.closest('[data-asset]');
  if (card && e.target === card && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); useAsset(card.dataset.asset); }
});
$('#assetList').addEventListener('dragstart', e => {
  const card = e.target.closest('[data-asset]');
  if (!card) return;
  e.dataTransfer.setData('text/x-kadr-asset', card.dataset.asset);
  e.dataTransfer.effectAllowed = 'copy';
});
