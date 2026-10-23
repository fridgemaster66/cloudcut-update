'use strict';
/* render.js — dźwięk, odtwarzacze klipów, składanie kadru, podgląd i odtwarzanie */

const canvas = $('#screen');
const mainCtx = canvas.getContext('2d');
let ctx = mainCtx; // na czas rysowania warstwy z maską wskazuje płótno warstwy
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
const keyCanvas = document.createElement('canvas');
const keyCtx = keyCanvas.getContext('2d', { willReadFrequently: true });
const layerCanvas = document.createElement('canvas');
const layerCtx = layerCanvas.getContext('2d');
const snapCanvas = document.createElement('canvas'); // migawka kadru dla warstw korekcyjnych
const snapCtx = snapCanvas.getContext('2d');
let previewBoxes = [];
let guidesOn = false;
let frameTails = new Map();     // clipId -> ile sekund klip trwa pod przejściem następnego
let tailTypes = new Map();      // clipId -> rodzaj przejścia następnego klipu
let exportFrames = null;        // clipId -> klatka z dekodera (szybki eksport)

/* ---------------- Dźwięk ---------------- */
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
    master = audioCtx.createGain();
    master.channelCountMode = 'explicit';
    master.channelCount = 2;
    master.channelInterpretation = 'speakers';
    // limiter na sumie: kilka głośnych klipów naraz nie przesteruje wyjścia
    const lim = createLimiter(audioCtx);
    master.connect(lim);
    monitorGain = audioCtx.createGain();
    monitorGain.gain.value = monVolume;
    lim.out.connect(monitorGain).connect(audioCtx.destination);
    exportDest = audioCtx.createMediaStreamDestination();
    lim.out.connect(exportDest);
    const split = audioCtx.createChannelSplitter(2);
    lim.out.connect(split);
    analysers = [0, 1].map(i => {
      const a = audioCtx.createAnalyser();
      a.fftSize = 1024;
      split.connect(a, i);
      return a;
    });
  }
  return audioCtx;
}

/* Miękki ogranicznik na sumie: do −1 dB bez zmian, powyżej łagodne zaokrąglenie — nigdy ponad skalę.
   (DynamicsCompressor w Chrome dokłada własne wzmocnienie, więc się tu nie nadaje.) */
let softClipCurve = null;
function createLimiter(ac) {
  if (!softClipCurve) {
    // wejście ±4 (12 dB zapasu); sufit 0,97 zostawia miejsce na lekkie przestrzały kodeków AAC/Opus
    const N = 8192, R = 4, knee = 0.85, ceil = 0.97;
    softClipCurve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) * 2 - 1) * R, a = Math.abs(x);
      const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
      softClipCurve[i] = Math.sign(x) * y;
    }
  }
  const pre = ac.createGain();
  pre.gain.value = 1 / 4;
  const sh = ac.createWaveShaper();
  sh.curve = softClipCurve;
  sh.oversample = '4x';
  pre.connect(sh);
  pre.out = sh;
  return pre;
}

/* Szyna ścieżki: głośność + panorama + miernik (mikser) */
const buses = new Map();
function getBus(trackId) {
  let b = buses.get(trackId);
  if (!b) {
    const ac = ensureAudio();
    const input = ac.createGain();
    const pan = ac.createStereoPanner();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    input.connect(pan).connect(master);
    pan.connect(an);
    b = { input, pan, an };
    buses.set(trackId, b);
  }
  return b;
}
function syncBuses() {
  for (const tr of state.tracks) {
    if (tr.kind === 'text') continue;
    const b = getBus(tr.id);
    b.input.gain.value = tr.vol ?? 1;
    b.pan.pan.value = clamp(tr.pan ?? 0, -1, 1);
  }
}

/* Efekty dźwięku klipu: korektor, głos, kompresor, usuwanie buczenia, oczyszczanie */
const AFX0 = { bass: 0, mid: 0, treble: 0, voice: false, comp: false, hum: false, clean: false };
const afxSig = a => (a ? [a.bass, a.mid, a.treble, a.voice, a.comp, a.hum, a.clean].join('|') : '');
function buildAudioFx(ac, a) {
  const nodes = [];
  const add = n => { if (nodes.length) nodes[nodes.length - 1].connect(n); nodes.push(n); return n; };
  if (a && (a.clean || a.voice)) { const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = a.voice ? 90 : 70; add(hp); }
  if (a?.clean) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 11000; add(lp); }
  if (a?.hum) for (const f of [50, 100, 150]) { const n = ac.createBiquadFilter(); n.type = 'notch'; n.frequency.value = f; n.Q.value = 30; add(n); }
  if (a?.bass) { const f = ac.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 200; f.gain.value = a.bass; add(f); }
  if (a?.mid) { const f = ac.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = 1200; f.Q.value = 0.8; f.gain.value = a.mid; add(f); }
  if (a?.treble) { const f = ac.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 4500; f.gain.value = a.treble; add(f); }
  if (a?.voice) { const f = ac.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = 3000; f.Q.value = 1; f.gain.value = 4; add(f); }
  if (a?.comp || a?.voice) {
    const c = ac.createDynamicsCompressor();
    c.threshold.value = a.voice ? -26 : -22; c.knee.value = 12; c.ratio.value = 4; c.attack.value = 0.005; c.release.value = 0.2;
    add(c);
    const makeup = ac.createGain(); makeup.gain.value = a.voice ? 1.6 : 1.35; add(makeup);
  }
  if (!nodes.length) { const g = ac.createGain(); nodes.push(g); }
  return { input: nodes[0], output: nodes[nodes.length - 1] };
}

function getPlayer(c) {
  let p = players.get(c.id);
  if (p && p.mediaId !== c.mediaId) { dropPlayer(c.id); p = null; }
  if (!p) {
    const m = media.get(c.mediaId);
    const el = document.createElement(c.kind === 'audio' ? 'audio' : 'video');
    el.preload = 'auto'; el.playsInline = true; el.preservesPitch = true; el.src = m.url;
    el.addEventListener('seeked', requestDraw);
    el.addEventListener('loadeddata', requestDraw);
    const ac = ensureAudio();
    const src = ac.createMediaElementSource(el);
    const gain = ac.createGain();
    gain.gain.value = 0;
    p = { el, gain, src, mediaId: c.mediaId, fx: null, sig: null, bus: null };
    players.set(c.id, p);
  }
  wirePlayer(c, p);
  return p;
}
/* Połączenia: źródło → efekty → głośność klipu → szyna ścieżki */
function wirePlayer(c, p) {
  const sig = afxSig(c.props.afx) + '#' + c.trackId;
  if (p.sig === sig) return;
  try { p.src.disconnect(); } catch { /* nie było połączeń */ }
  try { p.gain.disconnect(); } catch { /* j.w. */ }
  if (p.fx) { try { p.fx.output.disconnect(); } catch { /* j.w. */ } }
  p.fx = buildAudioFx(audioCtx, c.props.afx);
  p.src.connect(p.fx.input);
  p.fx.output.connect(p.gain);
  p.gain.connect(getBus(c.trackId).input);
  p.sig = sig;
}
function dropPlayer(id) {
  const p = players.get(id);
  if (!p) return;
  p.el.pause();
  try { p.src.disconnect(); p.gain.disconnect(); p.fx?.output.disconnect(); } catch { /* już odłączone */ }
  p.el.removeAttribute('src'); p.el.load();
  players.delete(id);
}
function gcPlayers() {
  for (const id of [...players.keys()]) {
    const c = clipById(id);
    if (!c || !media.has(c.mediaId) || c.mediaId !== players.get(id).mediaId) dropPlayer(id);
  }
}

/* Przejścia: klip poprzedni trwa jeszcze chwilę pod następnym */
const isTransition = type => typeof TRANS_IDS !== 'undefined' && TRANS_IDS.has(type);
function computeTails() {
  const m = new Map();
  tailTypes = new Map();
  for (const c of state.clips) {
    if (!isTransition(c.props.inType) || !(c.props.fadeIn > 0) || c.off) continue;
    const prev = state.clips.find(p => p.trackId === c.trackId && p.id !== c.id && !p.off && Math.abs(clipEnd(p) - c.start) < 0.002);
    if (prev) { m.set(prev.id, Math.min(c.props.fadeIn, c.dur)); tailTypes.set(prev.id, c.props.inType); }
  }
  return m;
}
function trackAudible(tr) {
  if (!tr || tr.muted) return false;
  return !state.tracks.some(t => t.solo) || tr.solo;
}
function audioGain(c, t, tail) {
  if (c.kind === 'video' && c.props.detached) return 0;
  if (!trackAudible(trackOf(c))) return 0;
  const local = t - c.start;
  let g = pv(c, 'volume', Math.min(local, c.dur)) ?? 1;
  if (tail) g *= clamp(1 - (local - c.dur) / tail, 0, 1);
  else {
    if (c.props.fadeIn > 0) g *= clamp(local / c.props.fadeIn, 0, 1);
    if (c.props.fadeOut > 0) g *= clamp((c.dur - local) / c.props.fadeOut, 0, 1);
  }
  return Math.max(0, g);
}
function srcTimeOf(c, t) {
  const m = media.get(c.mediaId);
  return clamp(c.in + (t - c.start) * c.speed, 0, Math.max(0, (m?.duration || 0) - 0.001));
}

function syncMedia() {
  const t = playhead;
  const live = playing && rate > 0 && !scrubbing;
  frameTails = computeTails();
  if (audioCtx) syncBuses();
  for (const c of state.clips) {
    if (!isAV(c) || !media.has(c.mediaId)) continue;
    const tail = frameTails.get(c.id) || 0;
    const active = !c.off && t >= c.start && t < clipEnd(c) + tail;
    const soon = live && c.start - t > 0 && c.start - t < 1.5;
    if (!active && !soon) {
      const p = players.get(c.id);
      if (p) { if (!p.el.paused) p.el.pause(); p.gain.gain.value = 0; }
      continue;
    }
    const p = getPlayer(c), el = p.el;
    if (active) {
      const target = srcTimeOf(c, t);
      const pr = clamp(c.speed * (live ? rate : 1), 0.0625, 16);
      if (el.playbackRate !== pr) el.playbackRate = pr;
      const atEnd = el.duration && target >= el.duration - 0.05;
      if (live && !atEnd) {
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.2 * Math.max(1, pr)) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (!exportFrames?.has(c.id) && Math.abs(el.currentTime - target) > frame() / 2 && (!el.seeking || scrubbing)) el.currentTime = target;
      }
      p.gain.gain.value = live ? audioGain(c, t, t >= clipEnd(c) ? tail : 0) : 0;
    } else {
      if (!el.paused) el.pause();
      p.gain.gain.value = 0;
      if (!el.seeking && Math.abs(el.currentTime - c.in) > 0.1) el.currentTime = c.in; // przygotowanie cięcia
    }
  }
}

/* ---------------- Składanie kadru ---------------- */
let drawQueued = false;
function requestDraw() {
  if (playing || drawQueued) return;
  drawQueued = true;
  setTimeout(() => { drawQueued = false; drawFrame(); }, 0);
}

function applyResolution() {
  const w = Math.max(2, Math.round(state.w * renderScale)), h = Math.max(2, Math.round(state.h * renderScale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  layoutStage();
}
function setRenderScale(s) {
  renderScale = s;
  applyResolution();
  drawFrame();
}

/* Postęp przejścia dla klipu w chwili t (null, gdy klip nie jest w przejściu) */
function transitionAt(c, t, tailMode) {
  if (tailMode) {
    const tail = frameTails.get(c.id) || 0;
    return tail ? { type: tailTypes.get(c.id), p: clamp((t - clipEnd(c)) / tail, 0, 1), role: 'out' } : null;
  }
  const P = c.props;
  if (!isTransition(P.inType) || !(P.fadeIn > 0)) return null;
  const local = t - c.start;
  return local < P.fadeIn ? { type: P.inType, p: clamp(local / P.fadeIn, 0, 1), role: 'in' } : null;
}

function drawFrame() {
  const t = playhead;
  ctx = mainCtx;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, state.w, state.h);
  previewBoxes = [];
  if (!playing) frameTails = computeTails();
  for (let i = state.tracks.length - 1; i >= 0; i--) {
    const tr = state.tracks[i];
    if (tr.kind === 'audio' || tr.hidden) continue;
    for (const c of clipsOn(tr.id)) {
      const tail = frameTails.get(c.id) || 0;
      if (c.off || t < c.start || t >= clipEnd(c) + tail) continue;
      const tailMode = t >= clipEnd(c);
      const tr2 = transitionAt(c, t, tailMode);
      try { drawVisual(c, t, tailMode, tr2); } catch (err) { console.warn(err); ctx = mainCtx; }
      if (tr2?.role === 'in') drawTransitionOverlay(tr2);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawOverlay();
  updateClock();
}

const easeOut = p => 1 - Math.pow(1 - p, 3);
const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
function backOut(p) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
/* Deterministyczny „losowy” szum — eksport wygląda tak samo za każdym razem */
function hash01(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function buildFilter(fx, blurAdd, extra = '') {
  const f = [];
  if (fx.brightness !== 100) f.push(`brightness(${fx.brightness}%)`);
  if (fx.contrast !== 100) f.push(`contrast(${fx.contrast}%)`);
  if (fx.saturate !== 100) f.push(`saturate(${fx.saturate}%)`);
  if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.grayscale) f.push(`grayscale(${fx.grayscale}%)`);
  if (fx.sepia) f.push(`sepia(${fx.sepia}%)`);
  const b = (fx.blur || 0) + blurAdd;
  if (b > 0.05) f.push(`blur(${(b * renderScale).toFixed(2)}px)`);
  if (extra) f.push(extra);
  return f.join(' ');
}

function chromaKey(src, sx, sy, sw, sh, key) {
  const k = Math.min(1, 960 / sw);
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  if (keyCanvas.width !== w || keyCanvas.height !== h) { keyCanvas.width = w; keyCanvas.height = h; }
  keyCtx.clearRect(0, 0, w, h);
  keyCtx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const img = keyCtx.getImageData(0, 0, w, h), d = img.data;
  const [kr, kg, kb] = hexRgb(key.color);
  const kcb = -0.1687 * kr - 0.3313 * kg + 0.5 * kb, kcr = 0.5 * kr - 0.4187 * kg - 0.0813 * kb;
  const t0 = key.tol * 1.3, soft = Math.max(1, key.soft * 1.3);
  const dom = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0; // dominujący kanał tła (rozlew koloru)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const cb = -0.1687 * r - 0.3313 * g + 0.5 * b, cr = 0.5 * r - 0.4187 * g - 0.0813 * b;
    const dist = Math.hypot(cb - kcb, cr - kcr);
    if (dist < t0) d[i + 3] = 0;
    else if (dist < t0 + soft) {
      d[i + 3] *= (dist - t0) / soft;
      const others = dom === 1 ? Math.max(r, b) : dom === 2 ? Math.max(r, g) : Math.max(g, b);
      if (d[i + dom] > others) d[i + dom] = others;
    }
  }
  keyCtx.putImageData(img, 0, 0);
  return keyCanvas;
}

function colorFill(P, R) {
  if (P.grad === 'solid') return P.c1;
  if (P.grad === 'radial') {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(R.w, R.h) / 2);
    g.addColorStop(0, P.c1); g.addColorStop(1, P.c2);
    return g;
  }
  const a = (P.angle || 0) * Math.PI / 180, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  const len = Math.abs(R.w * Math.sin(a)) / 2 + Math.abs(R.h * Math.cos(a)) / 2;
  const dx = Math.sin(a) * len, dy = -Math.cos(a) * len;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  g.addColorStop(0, P.c1); g.addColorStop(1, P.c2);
  return g;
}

function textLayout(P) {
  const txt = P.upper ? String(P.text).toUpperCase() : String(P.text);
  const font = `${P.italic ? 'italic ' : ''}${P.weight} ${P.size}px "${P.font}", Inter, sans-serif`;
  ctx.save();
  ctx.font = font;
  ctx.letterSpacing = (P.spacing || 0) + 'px';
  const lines = txt.split('\n');
  const bw = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
  ctx.restore();
  const lh = P.size * (P.lineHeight || 1.15);
  const pad = P.size * 0.42, padY = P.size * 0.24;
  return { font, lines, lh, pad, padY, total: lines.reduce((a, l) => a + l.length, 0), w: bw + pad * 2, h: lines.length * lh + padY * 2 };
}

function drawTextContent(P, L, R, typeP, sc) {
  if (P.bg) {
    ctx.save();
    ctx.globalAlpha *= P.bgOpacity ?? 1;
    ctx.fillStyle = P.bgColor;
    ctx.beginPath();
    ctx.roundRect(R.x, R.y, R.w, R.h, P.size * 0.16);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = L.font;
  ctx.letterSpacing = (P.spacing || 0) + 'px';
  ctx.textBaseline = 'middle';
  ctx.textAlign = P.align || 'center';
  const ax = P.align === 'left' ? R.x + L.pad : P.align === 'right' ? R.x + R.w - L.pad : R.x + R.w / 2;
  let remaining = typeP < 1 ? Math.floor(L.total * typeP) : Infinity;
  const k = renderScale * sc;
  L.lines.forEach((line, i) => {
    let s = line;
    if (remaining !== Infinity) { s = line.slice(0, Math.max(0, remaining)); remaining -= line.length; }
    if (!s) return;
    const y = R.y + L.padY + L.lh * (i + 0.5);
    ctx.save();
    if (P.glow) { ctx.shadowColor = P.color; ctx.shadowBlur = P.size * 0.45 * k; }
    else if (P.shadow) { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = P.size * 0.14 * k; ctx.shadowOffsetY = P.size * 0.035 * k; }
    if (P.stroke > 0) {
      ctx.lineWidth = P.stroke * 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = P.strokeColor;
      ctx.strokeText(s, ax, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = P.color;
    ctx.fillText(s, ax, y);
    if (P.glow) ctx.fillText(s, ax, y);
    ctx.restore();
  });
}

/* Wpływ przejścia na klip wchodzący (in) albo schodzący (out) */
function transitionMods(tr) {
  const W = state.w, H = state.h;
  const p = tr.p, e = easeInOut(p), inn = tr.role === 'in';
  const m = { dx: 0, dy: 0, sc: 1, alpha: 1, blur: 0, rot: 0, mask: null, filter: '' };
  const k = 1 - Math.abs(2 * p - 1); // 0 → 1 → 0, szczyt w połowie
  switch (tr.type) {
    case 'cross': if (inn) m.alpha = p; break;
    case 'dip-black': case 'dip-white': m.alpha = inn ? clamp(2 * p - 1, 0, 1) : clamp(1 - 2 * p, 0, 1); break;
    case 'flash': if (inn) m.alpha = p; break;
    case 'wipe-l': if (inn) m.mask = c => c.rect(W * (1 - e), 0, W * e + 1, H); break;
    case 'wipe-r': if (inn) m.mask = c => c.rect(0, 0, W * e, H); break;
    case 'wipe-u': if (inn) m.mask = c => c.rect(0, H * (1 - e), W, H * e + 1); break;
    case 'wipe-d': if (inn) m.mask = c => c.rect(0, 0, W, H * e); break;
    case 'push-l': m.dx = inn ? (1 - e) * W : -e * W; break;
    case 'push-r': m.dx = inn ? -(1 - e) * W : e * W; break;
    case 'push-u': m.dy = inn ? (1 - e) * H : -e * H; break;
    case 'push-d': m.dy = inn ? -(1 - e) * H : e * H; break;
    case 'cover-l': if (inn) m.dx = (1 - e) * W; break;
    case 'cover-r': if (inn) m.dx = -(1 - e) * W; break;
    case 'cover-u': if (inn) m.dy = (1 - e) * H; break;
    case 'cover-d': if (inn) m.dy = -(1 - e) * H; break;
    case 'zoom-in-t': if (inn) { m.sc = 0.7 + 0.3 * e; m.alpha = e; } else { m.sc = 1 + e; m.alpha = 1 - e; } break;
    case 'zoom-out-t': if (inn) { m.sc = 1.6 - 0.6 * e; m.alpha = e; } else { m.sc = 1 - 0.4 * e; m.alpha = 1 - e; } break;
    case 'iris': if (inn) m.mask = c => { c.moveTo(W / 2, H / 2); c.arc(W / 2, H / 2, Math.max(1, e * Math.hypot(W, H) / 2), 0, Math.PI * 2); }; break;
    case 'diamond': if (inn) m.mask = c => { const r = e * (W + H) / 2; c.moveTo(W / 2, H / 2 - r); c.lineTo(W / 2 + r, H / 2); c.lineTo(W / 2, H / 2 + r); c.lineTo(W / 2 - r, H / 2); c.closePath(); }; break;
    case 'clock': if (inn) m.mask = c => { const r = Math.hypot(W, H); c.moveTo(W / 2, H / 2); c.arc(W / 2, H / 2, r, -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2); c.closePath(); }; break;
    case 'barn': if (inn) m.mask = c => c.rect(W / 2 - e * W / 2, 0, e * W, H); break;
    case 'blinds': if (inn) m.mask = c => { const n = 10, h = H / n; for (let i = 0; i < n; i++) c.rect(0, i * h, W, h * e + 0.5); }; break;
    case 'blur-t': if (inn) { m.blur = (1 - e) * 50; m.alpha = e; } else { m.blur = e * 50; m.alpha = 1 - e; } break;
    case 'spin-t': if (inn) { m.rot = -(1 - e) * 120; m.sc = 0.4 + 0.6 * e; m.alpha = e; } else { m.rot = e * 120; m.sc = 1 - 0.6 * e; m.alpha = 1 - e; } break;
    case 'whip': m.dx = inn ? (1 - e) * W * 1.1 : -e * W * 1.1; m.blur = k * 70; break;
    case 'glitch': {
      const f = Math.floor((tr.p + (inn ? 0 : 0.37)) * 40);
      m.dx = (hash01(f) - 0.5) * W * 0.12 * k;
      m.dy = (hash01(f + 9) - 0.5) * H * 0.04 * k;
      m.filter = k > 0.15 ? `hue-rotate(${Math.round((hash01(f + 3) - 0.5) * 240 * k)}deg) saturate(${100 + 200 * k}%)` : '';
      if (inn) m.alpha = hash01(f + 5) < p ? 1 : 0;
      break;
    }
  }
  return m;
}
function drawTransitionOverlay(tr) {
  if (!['dip-black', 'dip-white', 'flash'].includes(tr.type)) return;
  const k = 1 - Math.abs(2 * tr.p - 1);
  if (k <= 0.001) return;
  ctx.save();
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.globalAlpha = tr.type === 'flash' ? k * 0.9 : k;
  ctx.globalCompositeOperation = tr.type === 'flash' ? 'lighter' : 'source-over';
  ctx.fillStyle = tr.type === 'dip-black' ? '#000' : '#fff';
  ctx.fillRect(0, 0, state.w, state.h);
  ctx.restore();
}

/* ---------------- Kształty i elementy animowane ---------------- */
function shapePath(P, R) {
  const { x, y, w, h } = R;
  const cx = x + w / 2, cy = y + h / 2;
  ctx.beginPath();
  switch (P.shape) {
    case 'circle': ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'ring': ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.ellipse(cx, cy, w / 2 * 0.72, h / 2 * 0.72, 0, 0, Math.PI * 2, true); break;
    case 'triangle': ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); break;
    case 'star': {
      const n = P.points || 5;
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 ? 0.45 : 1, a = -Math.PI / 2 + i * Math.PI / n;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * w / 2 * r, cy + Math.sin(a) * h / 2 * r);
      }
      ctx.closePath();
      break;
    }
    case 'arrow':
      ctx.moveTo(x, cy - h * 0.18); ctx.lineTo(x + w * 0.62, cy - h * 0.18); ctx.lineTo(x + w * 0.62, y);
      ctx.lineTo(x + w, cy); ctx.lineTo(x + w * 0.62, y + h); ctx.lineTo(x + w * 0.62, cy + h * 0.18); ctx.lineTo(x, cy + h * 0.18); ctx.closePath();
      break;
    case 'heart':
      ctx.moveTo(cx, y + h * 0.3);
      ctx.bezierCurveTo(cx, y, x, y, x, y + h * 0.32);
      ctx.bezierCurveTo(x, y + h * 0.62, cx, y + h * 0.78, cx, y + h);
      ctx.bezierCurveTo(cx, y + h * 0.78, x + w, y + h * 0.62, x + w, y + h * 0.32);
      ctx.bezierCurveTo(x + w, y, cx, y, cx, y + h * 0.3);
      break;
    case 'callout':
      ctx.roundRect(x, y, w, h * 0.78, Math.min(P.corner || 0, h * 0.39));
      ctx.moveTo(x + w * 0.2, y + h * 0.76); ctx.lineTo(x + w * 0.16, y + h); ctx.lineTo(x + w * 0.36, y + h * 0.76);
      break;
    case 'line': ctx.rect(x, cy - Math.max(2, P.strokeW || 6) / 2, w, Math.max(2, P.strokeW || 6)); break;
    case 'roundrect': ctx.roundRect(x, y, w, h, Math.min(P.corner || 0, w / 2, h / 2)); break;
    default: ctx.rect(x, y, w, h);
  }
}
function drawShape(P, R) {
  shapePath(P, R);
  if (P.fillOn !== false) { ctx.fillStyle = P.fill; ctx.fill('evenodd'); }
  if (P.strokeW > 0 && P.shape !== 'line') { ctx.lineWidth = P.strokeW; ctx.strokeStyle = P.stroke; ctx.lineJoin = 'round'; ctx.stroke(); }
}

const noiseCanvas = document.createElement('canvas');
noiseCanvas.width = noiseCanvas.height = 192;
const noiseCtx = noiseCanvas.getContext('2d');
let noiseFrame = -1;
function elementBox(P) {
  const W = state.w, H = state.h;
  switch (P.el) {
    case 'progress': return { x: -W / 2, y: -P.barH / 2, w: W, h: P.barH };
    case 'countdown': { const r = Math.min(W, H) * 0.2; return { x: -r, y: -r, w: 2 * r, h: 2 * r }; }
    case 'timer': return { x: -H * 0.32, y: -H * 0.07, w: H * 0.64, h: H * 0.14 };
    case 'subscribe': return { x: -H * 0.3, y: -H * 0.065, w: H * 0.6, h: H * 0.13 };
    case 'rec': return { x: -W / 2, y: -H / 2, w: W, h: H };
    default: return { x: -W / 2, y: -H / 2, w: W, h: H };
  }
}
function drawElement(c, P, local, R) {
  const W = state.w, H = state.h, t = local, dur = c.dur, f = Math.floor((c.start + t) * state.fps);
  const seed = (P.seed || 1) * 97;
  switch (P.el) {
    case 'progress': {
      ctx.fillStyle = P.color2; ctx.globalAlpha *= 0.35; ctx.fillRect(R.x, R.y, R.w, R.h); ctx.globalAlpha /= 0.35;
      ctx.fillStyle = P.color; ctx.fillRect(R.x, R.y, R.w * clamp(t / dur, 0, 1), R.h);
      break;
    }
    case 'countdown': {
      const n = Math.max(1, P.count | 0), per = dur / n;
      const num = Math.max(1, n - Math.floor(t / per)), pp = (t % per) / per;
      const r = R.w / 2;
      ctx.lineWidth = r * 0.08;
      ctx.strokeStyle = P.color2; ctx.globalAlpha *= 0.3; ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha /= 0.3;
      ctx.strokeStyle = P.color; ctx.beginPath(); ctx.arc(0, 0, r * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - pp)); ctx.stroke();
      ctx.fillStyle = P.color2; ctx.font = `800 ${r * 1.1}px Montserrat, Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); const s = 1 + 0.25 * Math.max(0, 1 - pp * 4); ctx.scale(s, s); ctx.fillText(String(num), 0, r * 0.04); ctx.restore();
      break;
    }
    case 'timer': {
      const s = t * (P.speed || 1);
      const txt = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 100)).padStart(2, '0')}`;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, R.h * 0.25); ctx.fill();
      ctx.fillStyle = P.color2; ctx.font = `500 ${R.h * 0.62}px "JetBrains Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, R.h * 0.03);
      break;
    }
    case 'subscribe': {
      const click = dur * 0.45, done = t > click;
      const pop = clamp(t / 0.35, 0, 1), sc = Math.max(0, backOut(pop));
      ctx.save(); ctx.scale(sc, sc);
      ctx.fillStyle = done ? '#3a3f4b' : P.color;
      ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, R.h * 0.18); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${R.h * 0.36}px Montserrat, Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(done ? 'SUBSKRYBUJESZ ✓' : (P.text || 'SUBSKRYBUJ'), -R.h * 0.15, 0);
      // dzwonek
      const bx = R.x + R.w - R.h * 0.42, swing = done ? Math.sin((t - click) * 18) * 0.35 * Math.exp(-(t - click) * 3) : 0;
      ctx.save(); ctx.translate(bx, 0); ctx.rotate(swing);
      ctx.beginPath(); ctx.moveTo(-R.h * 0.16, R.h * 0.14); ctx.quadraticCurveTo(-R.h * 0.16, -R.h * 0.2, 0, -R.h * 0.2); ctx.quadraticCurveTo(R.h * 0.16, -R.h * 0.2, R.h * 0.16, R.h * 0.14); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, R.h * 0.19, R.h * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // kursor klika
      if (t > click - 0.6 && t < click + 0.5) {
        const k2 = clamp((t - (click - 0.6)) / 0.6, 0, 1), cx2 = R.w * 0.35 * (1 - easeOut(k2)), cy2 = R.h * 0.9 * (1 - easeOut(k2)) + R.h * 0.1;
        const press = t > click && t < click + 0.15 ? 0.85 : 1;
        ctx.save(); ctx.translate(cx2, cy2); ctx.scale(press * R.h / 100, press * R.h / 100);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 46); ctx.lineTo(12, 35); ctx.lineTo(21, 54); ctx.lineTo(29, 50); ctx.lineTo(20, 32); ctx.lineTo(36, 32); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case 'lightleak': {
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 3; i++) {
        const sp = (P.speed || 1) * (0.15 + i * 0.07);
        const x = (Math.sin(t * sp * 2 + seed + i * 2) * 0.5 + (i - 1) * 0.3) * W, y = (Math.cos(t * sp * 1.6 + seed * 0.3 + i) * 0.35) * H;
        const r = (0.45 + 0.2 * Math.sin(t * sp + i)) * W;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const cols = [P.color, '#ffb347', '#ff4d6d'];
        g.addColorStop(0, cols[i % 3]); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(R.x, R.y, R.w, R.h);
      }
      break;
    }
    case 'grain': {
      if (noiseFrame !== f) {
        noiseFrame = f;
        const img = noiseCtx.createImageData(192, 192), d = img.data;
        for (let i = 0; i < d.length; i += 4) { const v = hash01(i * 0.37 + f * 13.1) * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
        noiseCtx.putImageData(img, 0, 0);
      }
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = ctx.createPattern(noiseCanvas, 'repeat');
      ctx.save(); ctx.scale(2, 2); ctx.fillRect(R.x / 2, R.y / 2, R.w / 2, R.h / 2); ctx.restore();
      break;
    }
    case 'letterbox': {
      const bar = Math.max(0, (H - W / (P.ratio || 2.39)) / 2);
      ctx.fillStyle = P.color === '#ff4d5e' ? '#000' : P.color;
      ctx.fillRect(R.x, R.y, R.w, bar); ctx.fillRect(R.x, R.y + R.h - bar, R.w, bar);
      break;
    }
    case 'confetti': case 'snow': case 'bokeh': {
      const n = P.el === 'bokeh' ? 26 : P.el === 'snow' ? 140 : 120;
      const colors = P.el === 'confetti' ? ['#ff4d6d', '#ffd34d', '#4dd2ff', '#7dff8a', '#c38bff', '#ff9f43'] : [P.color2];
      if (P.el === 'bokeh') ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < n; i++) {
        const r1 = hash01(i + seed), r2 = hash01(i * 3.1 + seed), r3 = hash01(i * 7.7 + seed);
        const speed = (P.el === 'bokeh' ? 0.03 : P.el === 'snow' ? 0.12 : 0.28) * (0.6 + r2) * (P.speed || 1);
        const y = ((r1 + t * speed) % 1.15 - 0.075) * H - H / 2;
        const x = (r2 - 0.5) * W + Math.sin(t * (1 + r3 * 2) + i) * W * (P.el === 'confetti' ? 0.03 : 0.015);
        ctx.fillStyle = colors[i % colors.length];
        if (P.el === 'confetti') {
          ctx.save(); ctx.translate(x, y); ctx.rotate(t * (2 + r3 * 6) + i); ctx.scale(1, Math.cos(t * (3 + r1 * 5) + i));
          ctx.fillRect(-H * 0.008, -H * 0.004, H * 0.016, H * 0.008); ctx.restore();
        } else if (P.el === 'snow') {
          ctx.globalAlpha = 0.5 + 0.5 * r3; ctx.beginPath(); ctx.arc(x, y, H * (0.002 + 0.004 * r3), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        } else {
          const rr = H * (0.03 + 0.06 * r3), g = ctx.createRadialGradient(x, y, 0, x, y, rr);
          g.addColorStop(0, ['rgba(255,214,140,.55)', 'rgba(140,200,255,.45)', 'rgba(255,140,190,.45)'][i % 3]); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    }
    case 'rec': {
      const m = H * 0.05, L = H * 0.07;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = H * 0.004;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x0 = sx * (W / 2 - m), y0 = sy * (H / 2 - m);
        ctx.beginPath(); ctx.moveTo(x0, y0 - sy * -L); ctx.lineTo(x0, y0); ctx.lineTo(x0 - sx * L, y0); ctx.stroke();
      }
      ctx.font = `600 ${H * 0.04}px "JetBrains Mono", monospace`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      if (Math.floor((c.start + t) * 2) % 2 === 0) { ctx.fillStyle = '#ff2b2b'; ctx.beginPath(); ctx.arc(-W / 2 + m * 2.2, -H / 2 + m * 2.2, H * 0.014, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.fillText('REC', -W / 2 + m * 2.2 + H * 0.03, -H / 2 + m * 2.2);
      ctx.textAlign = 'right'; ctx.fillText(tc(c.start + t), W / 2 - m * 2, -H / 2 + m * 2.2);
      break;
    }
    case 'bg-gradient': {
      const h = (t * 12 * (P.speed || 1)) % 360;
      const g = ctx.createLinearGradient(R.x, R.y, R.x + R.w, R.y + R.h);
      g.addColorStop(0, P.color); g.addColorStop(1, P.color2);
      ctx.fillStyle = g; ctx.fillRect(R.x, R.y, R.w, R.h);
      ctx.globalCompositeOperation = 'soft-light';
      const x = Math.cos(h * Math.PI / 180) * W * 0.4, y = Math.sin(h * Math.PI / 180) * H * 0.4;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, W * 0.7); g2.addColorStop(0, 'rgba(255,255,255,.7)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2; ctx.fillRect(R.x, R.y, R.w, R.h);
      break;
    }
    case 'bg-dots': case 'bg-grid': case 'bg-stripes': {
      ctx.fillStyle = P.color; ctx.fillRect(R.x, R.y, R.w, R.h);
      ctx.fillStyle = ctx.strokeStyle = P.color2; ctx.globalAlpha *= 0.35;
      const s = H / 14, off = (t * s * 0.6 * (P.speed || 1)) % s;
      if (P.el === 'bg-dots') for (let y = R.y - s + off; y < R.y + R.h + s; y += s) for (let x = R.x - s + off; x < R.x + R.w + s; x += s) { ctx.beginPath(); ctx.arc(x, y, s * 0.12, 0, Math.PI * 2); ctx.fill(); }
      else if (P.el === 'bg-grid') { ctx.lineWidth = Math.max(1, s * 0.04); ctx.beginPath(); for (let x = R.x - s + off; x < R.x + R.w + s; x += s) { ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h); } for (let y = R.y - s + off; y < R.y + R.h + s; y += s) { ctx.moveTo(R.x, y); ctx.lineTo(R.x + R.w, y); } ctx.stroke(); }
      else { ctx.lineWidth = s * 0.35; ctx.beginPath(); for (let x = R.x - R.h - s + off * 2; x < R.x + R.w + s; x += s * 1.2) { ctx.moveTo(x, R.y + R.h); ctx.lineTo(x + R.h, R.y); } ctx.stroke(); }
      break;
    }
  }
}

/* Maska w układzie klipu (procenty pudełka treści) */
function maskPath(mask, R) {
  const cx = R.x + R.w / 2 + R.w * (mask.x || 0) / 100, cy = R.y + R.h / 2 + R.h * (mask.y || 0) / 100;
  const w = R.w * (mask.w ?? 60) / 100, h = R.h * (mask.h ?? 60) / 100;
  ctx.beginPath();
  if (mask.type === 'ellipse') ctx.ellipse(cx, cy, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
  else ctx.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(mask.round || 0, w / 2, h / 2));
}

function drawVisual(c, t, tailMode, trans) {
  const P = c.props;
  const W = state.w, H = state.h;
  const local = clamp(t - c.start, 0, c.dur);
  let alpha = pv(c, 'opacity', local);
  let sc = pv(c, 'scale', local);
  let ox = pv(c, 'x', local), oy = pv(c, 'y', local);
  let rot = pv(c, 'rotation', local) || 0;
  let blurAdd = 0, wipe = 1, typeP = 1, transMask = null, extraFilter = '';
  if (!tailMode) {
    const ip = P.fadeIn > 0 ? clamp(local / P.fadeIn, 0, 1) : 1;
    const op = P.fadeOut > 0 ? clamp((c.dur - local) / P.fadeOut, 0, 1) : 1;
    for (const [type, p, dir] of [[P.inType, ip, 1], [P.outType, op, -1]]) {
      if (p >= 1 || !type || type === 'none' || isTransition(type)) continue;
      const e = easeOut(p);
      switch (type) {
        case 'fade': alpha *= p; break;
        case 'slide-l': ox -= (1 - e) * W; break;
        case 'slide-r': ox += (1 - e) * W; break;
        case 'slide-u': oy -= (1 - e) * H; break;
        case 'slide-d': oy += (1 - e) * H; break;
        case 'zoom-in': sc *= 0.5 + 0.5 * e; alpha *= p; break;
        case 'zoom-out': sc *= 1.6 - 0.6 * e; alpha *= p; break;
        case 'wipe': wipe = Math.min(wipe, e); break;
        case 'blur': blurAdd += (1 - e) * 40; alpha *= p; break;
        case 'pop': sc *= Math.max(0, backOut(p)); break;
        case 'spin': rot += (1 - e) * 180 * -dir; sc *= 0.3 + 0.7 * e; alpha *= p; break;
        case 'type': typeP = Math.min(typeP, p); break;
      }
    }
  }
  if (trans) {
    const m = transitionMods(trans);
    ox += m.dx; oy += m.dy; sc *= m.sc; alpha *= m.alpha; blurAdd += m.blur; rot += m.rot;
    transMask = m.mask; extraFilter = m.filter;
  }
  if (alpha <= 0.002 || sc <= 0.002) return;

  let R, paint;
  if (c.kind === 'video' || c.kind === 'image' || c.kind === 'adjust') {
    let src, sw, sh;
    if (c.kind === 'video') {
      if (!media.has(c.mediaId)) return;
      const ef = exportFrames?.get(c.id);
      if (ef) { src = ef; sw = ef.width; sh = ef.height; }
      else {
        const p = getPlayer(c);
        if (p.el.readyState < 2 || !p.el.videoWidth) return;
        src = p.el; sw = p.el.videoWidth; sh = p.el.videoHeight;
      }
    } else if (c.kind === 'image') {
      const m = media.get(c.mediaId);
      if (!m?.img) return;
      src = m.img; sw = m.w; sh = m.h;
    } else {
      // warstwa korekcyjna: zdjęcie tego, co już narysowano pod nią
      if (snapCanvas.width !== canvas.width || snapCanvas.height !== canvas.height) { snapCanvas.width = canvas.width; snapCanvas.height = canvas.height; }
      snapCtx.clearRect(0, 0, snapCanvas.width, snapCanvas.height);
      snapCtx.drawImage(canvas, 0, 0);
      src = snapCanvas; sw = snapCanvas.width; sh = snapCanvas.height;
    }
    const cr = P.crop || { l: 0, r: 0, t: 0, b: 0 };
    let fx = W / sw, fy = H / sh;
    if (c.kind !== 'adjust') {
      if (P.fit === 'contain') fx = fy = Math.min(fx, fy);
      else if (P.fit === 'cover') fx = fy = Math.max(fx, fy);
    }
    const fw = sw * fx, fh = sh * fy;
    const sx = sw * cr.l / 100, sy = sh * cr.t / 100, cw = sw * (100 - cr.l - cr.r) / 100, ch = sh * (100 - cr.t - cr.b) / 100;
    if (cw < 1 || ch < 1) return;
    R = { x: -fw / 2 + fw * cr.l / 100, y: -fh / 2 + fh * cr.t / 100, w: fw * cw / sw, h: fh * ch / sh };
    paint = () => {
      const gpu = (P.lut?.id || P.key?.on) && typeof gpuEffects === 'function' ? gpuEffects(src, sx, sy, cw, ch, P) : null;
      if (gpu) ctx.drawImage(gpu, 0, 0, gpu.width, gpu.height, R.x, R.y, R.w, R.h);
      else if (P.key?.on) {
        const kc = chromaKey(src, sx, sy, cw, ch, P.key);
        ctx.drawImage(kc, 0, 0, kc.width, kc.height, R.x, R.y, R.w, R.h);
      } else ctx.drawImage(src, sx, sy, cw, ch, R.x, R.y, R.w, R.h);
    };
  } else if (c.kind === 'color') {
    R = { x: -W / 2, y: -H / 2, w: W, h: H };
    paint = () => { ctx.fillStyle = colorFill(P, R); ctx.fillRect(R.x, R.y, R.w, R.h); };
  } else if (c.kind === 'text') {
    const L = textLayout(P);
    R = { x: -L.w / 2, y: -L.h / 2, w: L.w, h: L.h };
    paint = () => drawTextContent(P, L, R, typeP, sc);
  } else if (c.kind === 'shape') {
    R = { x: -P.w / 2, y: -P.h / 2, w: P.w, h: P.h };
    paint = () => drawShape(P, R);
  } else if (c.kind === 'element') {
    R = elementBox(P);
    paint = () => drawElement(c, P, local, R);
  } else return;

  const useLayer = (P.mask && P.mask.type && P.mask.type !== 'none') || !!transMask;
  if (useLayer) {
    if (layerCanvas.width !== canvas.width || layerCanvas.height !== canvas.height) { layerCanvas.width = canvas.width; layerCanvas.height = canvas.height; }
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
    ctx = layerCtx;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  }
  const tx = W / 2 + ox, ty = H / 2 + oy;
  const fh = P.flipH ? -1 : 1, fv = P.flipV ? -1 : 1;
  ctx.save();
  ctx.translate(tx, ty);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  ctx.scale(sc * fh, sc * fv);
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.globalCompositeOperation = useLayer ? 'source-over' : (P.blend || 'source-over');
  const radius = Math.min(P.radius || 0, R.w / 2, R.h / 2);
  if (P.dropShadow && c.kind !== 'text') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 40 * renderScale * sc;
    ctx.shadowOffsetY = 14 * renderScale * sc;
    ctx.fillStyle = '#000';
    if (c.kind === 'shape') shapePath(P, R); else { ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, radius); }
    ctx.fill();
    ctx.restore();
  }
  if (radius > 0) { ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, radius); ctx.clip(); }
  if (wipe < 1) { ctx.beginPath(); ctx.rect(R.x, R.y, R.w * wipe, R.h); ctx.clip(); }
  const fxs = P.fx ? buildFilter(P.fx, blurAdd, extraFilter) : [blurAdd > 0.05 ? `blur(${blurAdd * renderScale}px)` : '', extraFilter].filter(Boolean).join(' ');
  if (fxs) ctx.filter = fxs;
  paint();
  ctx.filter = 'none';
  if (P.fx?.temp) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = clamp(alpha, 0, 1) * Math.min(1, Math.abs(P.fx.temp) / 100) * 0.75;
    ctx.fillStyle = P.fx.temp > 0 ? '#ff8a1f' : '#1f7bff';
    ctx.fillRect(R.x, R.y, R.w, R.h);
  }
  if (P.fx?.vignette) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp(alpha, 0, 1) * P.fx.vignette / 100;
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2, rr = Math.hypot(R.w, R.h) / 2;
    const g = ctx.createRadialGradient(cx, cy, rr * 0.35, cx, cy, rr);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(R.x, R.y, R.w, R.h);
  }
  // maska klipu (w układzie klipu, z miękką krawędzią)
  if (P.mask && P.mask.type && P.mask.type !== 'none') {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = P.mask.invert ? 'destination-out' : 'destination-in';
    if (P.mask.feather > 0) ctx.filter = `blur(${(P.mask.feather * renderScale * sc).toFixed(2)}px)`;
    ctx.fillStyle = '#000';
    maskPath(P.mask, R);
    ctx.fill();
    ctx.filter = 'none';
  }
  ctx.restore();
  if (useLayer) {
    // maska przejścia w układzie kadru
    if (transMask) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      transMask(ctx);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }
    ctx = mainCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = P.blend || 'source-over';
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }

  // prostokąt do chwytania na podglądzie
  const lx = (R.x + R.w / 2) * sc * fh, ly = (R.y + R.h / 2) * sc * fv;
  const a = rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  previewBoxes.push({ id: c.id, cx: tx + lx * cos - ly * sin, cy: ty + lx * sin + ly * cos, w: R.w * sc, h: R.h * sc, rot, ox, oy, sc });
}


/* ---------------- Nakładka podglądu ---------------- */
function layoutStage() {
  const st = $('#stage');
  const r = st.getBoundingClientRect();
  const pad = document.fullscreenElement === st ? 0 : 16;
  const k = Math.min((r.width - pad * 2) / state.w, (r.height - pad * 2) / state.h);
  const w = Math.max(10, Math.floor(state.w * k)), h = Math.max(10, Math.floor(state.h * k));
  const box = $('#screenBox');
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  const dpr = devicePixelRatio || 1;
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  drawOverlay();
}

function drawOverlay() {
  const k = overlay.width / state.w;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!k) return;
  octx.setTransform(k, 0, 0, k, 0, 0);
  const px = (devicePixelRatio || 1) / k; // jeden piksel ekranu w jednostkach projektu
  const W = state.w, H = state.h;
  if (guidesOn) {
    octx.lineWidth = px;
    octx.strokeStyle = 'rgba(255,255,255,.28)';
    octx.beginPath();
    for (const f of [1 / 3, 2 / 3]) { octx.moveTo(W * f, 0); octx.lineTo(W * f, H); octx.moveTo(0, H * f); octx.lineTo(W, H * f); }
    octx.stroke();
    octx.setLineDash([6 * px, 5 * px]);
    octx.strokeStyle = 'rgba(107,149,255,.75)';
    octx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    octx.strokeStyle = 'rgba(255,211,77,.75)';
    octx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
    octx.setLineDash([]);
    octx.strokeStyle = 'rgba(255,255,255,.5)';
    octx.beginPath(); octx.moveTo(W / 2 - 14 * px, H / 2); octx.lineTo(W / 2 + 14 * px, H / 2); octx.moveTo(W / 2, H / 2 - 14 * px); octx.lineTo(W / 2, H / 2 + 14 * px); octx.stroke();
  }
  if (playing || exporting || monitor !== 'program') return;
  for (const b of previewBoxes) {
    if (!sel.has(b.id)) continue;
    octx.save();
    octx.translate(b.cx, b.cy);
    octx.rotate(b.rot * Math.PI / 180);
    octx.lineWidth = 1.5 * px;
    octx.strokeStyle = '#ffd34d';
    octx.setLineDash([6 * px, 4 * px]);
    octx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    octx.setLineDash([]);
    octx.fillStyle = '#ffd34d';
    const hs = 9 * px;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) octx.fillRect(x * b.w / 2 - hs / 2, y * b.h / 2 - hs / 2, hs, hs);
    octx.restore();
  }
}

function toProject(e) {
  const r = overlay.getBoundingClientRect();
  const k = state.w / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
}
function boxLocal(b, p) {
  const a = -b.rot * Math.PI / 180, dx = p.x - b.cx, dy = p.y - b.cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}
function hitPreview(p) {
  // uchwyty skalowania zaznaczonego obiektu mają pierwszeństwo
  for (const b of [...previewBoxes].reverse()) {
    if (!sel.has(b.id)) continue;
    const l = boxLocal(b, p), tol = 12 * p.k;
    if (Math.abs(Math.abs(l.x) - b.w / 2) < tol && Math.abs(Math.abs(l.y) - b.h / 2) < tol) return { b, mode: 'scale' };
  }
  for (const b of [...previewBoxes].reverse()) {
    const l = boxLocal(b, p);
    if (Math.abs(l.x) <= b.w / 2 && Math.abs(l.y) <= b.h / 2) return { b, mode: 'move' };
  }
  return null;
}

overlay.addEventListener('pointermove', e => {
  if (playing || e.buttons) return;
  const h = hitPreview(toProject(e));
  overlay.className = h ? (h.mode === 'scale' ? 'can-scale' : 'can-move') : '';
});
overlay.addEventListener('pointerdown', e => {
  if (playing || e.button !== 0) return;
  const p0 = toProject(e);
  const h = hitPreview(p0);
  if (!h) { sel.clear(); renderLanes(); renderInspector(); drawFrame(); return; }
  const c = clipById(h.b.id);
  if (isLocked(c)) { toast('Ścieżka tego obiektu jest zablokowana'); return; }
  if (!sel.has(c.id)) { sel = new Set([c.id]); renderLanes(); renderInspector(); drawFrame(); }
  const local = localAt(c);
  const ox = pv(c, 'x', local), oy = pv(c, 'y', local), os = pv(c, 'scale', local);
  const d0 = Math.hypot(p0.x - h.b.cx, p0.y - h.b.cy) || 1;
  let moved = false;
  overlay.setPointerCapture(e.pointerId);
  const mv = ev => {
    const p = toProject(ev);
    moved = true;
    if (h.mode === 'scale') {
      const s = clamp(os * Math.hypot(p.x - h.b.cx, p.y - h.b.cy) / d0, 0.02, 10);
      setProp(c, 'scale', Math.round(s * 1000) / 1000);
    } else {
      let nx = ox + (p.x - p0.x), ny = oy + (p.y - p0.y);
      if (snapOn && !ev.altKey) {
        const tol = 10 * p.k;
        if (Math.abs(nx) < tol) nx = 0;
        if (Math.abs(ny) < tol) ny = 0;
      }
      if (ev.shiftKey) { if (Math.abs(nx - ox) > Math.abs(ny - oy)) ny = oy; else nx = ox; }
      setProp(c, 'x', Math.round(nx));
      setProp(c, 'y', Math.round(ny));
    }
    drawFrame();
  };
  const up = () => {
    overlay.removeEventListener('pointermove', mv);
    overlay.removeEventListener('pointerup', up);
    overlay.removeEventListener('pointercancel', up);
    if (moved) { commit(); renderInspector(); renderLanes(); }
  };
  overlay.addEventListener('pointermove', mv);
  overlay.addEventListener('pointerup', up);
  overlay.addEventListener('pointercancel', up);
});
overlay.addEventListener('dblclick', e => {
  const h = hitPreview(toProject(e));
  if (h && clipById(h.b.id)?.kind === 'text') {
    sel = new Set([h.b.id]); renderAll();
    const ta = $('#inspector textarea'); ta?.focus(); ta?.select();
  }
});

/* ---------------- Odtwarzanie ---------------- */
const schedule = cb => (document.hidden ? setTimeout(() => cb(performance.now()), 1000 / state.fps) : requestAnimationFrame(cb));

function playRange() {
  const end = projectEnd();
  if (state.range && state.range.out > state.range.in) return { a: state.range.in, b: state.range.out };
  return { a: 0, b: end };
}
function play(r = 1) {
  if (monitor === 'source') setMonitor('program');
  const end = projectEnd();
  if (end <= 0) { toast('Najpierw dodaj coś na oś czasu'); return; }
  if (r > 0 && playhead >= end - EPS) playhead = loopOn ? playRange().a : 0;
  ensureAudio().resume();
  rate = r;
  playing = true;
  document.body.classList.add('is-playing');
  $('#btnPlay').setAttribute('aria-label', 'Pauza');
  playT0 = playhead; playP0 = performance.now();
  syncMedia();
  updateRateBadge();
  schedule(tick);
}
function pause() {
  if (!playing) return;
  playing = false;
  rate = 1;
  playStopAt = null;
  document.body.classList.remove('is-playing');
  $('#btnPlay').setAttribute('aria-label', 'Odtwórz');
  for (const p of players.values()) { p.el.pause(); p.gain.gain.value = 0; }
  updateRateBadge();
  syncMedia(); drawFrame(); updatePlayheadUI(true); drawMeter(true);
  renderInspectorValues();
}
const togglePlay = () => (playing ? pause() : play());
function setRate(r) {
  if (!playing) { play(r); return; }
  playT0 = playhead; playP0 = performance.now();
  rate = r;
  updateRateBadge();
  syncMedia();
}
function updateRateBadge() {
  $('#rateBadge').textContent = playing && rate !== 1 ? (rate > 0 ? '▶ ' : '◀ ') + Math.abs(rate) + '×' : '';
}

function tick(now) {
  if (!playing) return;
  const end = projectEnd();
  playhead = playT0 + (now - playP0) / 1000 * rate;
  if (playStopAt !== null && rate > 0 && playhead >= playStopAt) {
    // „odtwórz wokół głowicy” — wracamy tam, skąd ruszyliśmy
    playStopAt = null;
    pause();
    seek(playAroundOrigin);
    return;
  }
  if (exporting) {
    if (playhead >= exporting.to) { playhead = exporting.to; finishExport(); return; }
    updateExportProgress();
  } else if (loopOn && rate > 0) {
    const r = playRange();
    if (playhead >= r.b) { playhead = r.a; playT0 = playhead; playP0 = now; for (const p of players.values()) p.el.pause(); }
  } else if (playhead >= end && rate > 0) { playhead = end; pause(); return; }
  if (playhead <= 0 && rate < 0) { playhead = 0; pause(); return; }
  syncMedia();
  drawFrame();
  updatePlayheadUI(true);
  drawMeter();
  schedule(tick);
}

function seek(t) {
  playhead = Math.max(0, t);
  if (playing) { playT0 = playhead; playP0 = performance.now(); }
  syncMedia();
  drawFrame();
  updatePlayheadUI();
  if (!playing) renderInspectorValues();
}

function updateClock() {
  $('#tcNow').textContent = tc(playhead);
  $('#tcEnd').textContent = tc(projectEnd());
}

/* ---------------- Wskaźnik wysterowania ---------------- */
const meterCv = $('#meterCv');
const meterBuf = new Float32Array(1024);
const meterState = { lvl: [0, 0], peak: [0, 0], hold: [0, 0] };
function drawMeter(reset = false) {
  const dpr = devicePixelRatio || 1;
  const w = meterCv.clientWidth, h = meterCv.clientHeight;
  if (!w || !h) return;
  if (meterCv.width !== Math.round(w * dpr) || meterCv.height !== Math.round(h * dpr)) { meterCv.width = Math.round(w * dpr); meterCv.height = Math.round(h * dpr); }
  const g = meterCv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const now = performance.now();
  for (let ch = 0; ch < 2; ch++) {
    let p = 0;
    if (!reset && analysers) {
      analysers[ch].getFloatTimeDomainData(meterBuf);
      for (let i = 0; i < meterBuf.length; i++) { const v = Math.abs(meterBuf[i]); if (v > p) p = v; }
    }
    const db = p > 0 ? 20 * Math.log10(p) : -90;
    const lvl = clamp((db + 60) / 60, 0, 1);
    meterState.lvl[ch] = reset ? 0 : Math.max(lvl, meterState.lvl[ch] - 0.04);
    if (lvl >= meterState.peak[ch] || now > meterState.hold[ch]) { meterState.peak[ch] = reset ? 0 : lvl; meterState.hold[ch] = now + 1200; }
    const bw = (w - 7) / 2, x = 3 + ch * (bw + 1);
    const top = 8, hh = h - top - 4;
    g.fillStyle = '#1a1d24';
    g.fillRect(x, top, bw, hh);
    const grad = g.createLinearGradient(0, top + hh, 0, top);
    grad.addColorStop(0, '#2fbf71'); grad.addColorStop(0.75, '#2fbf71'); grad.addColorStop(0.88, '#f2c94c'); grad.addColorStop(1, '#ff4d5e');
    g.fillStyle = grad;
    const lh = hh * meterState.lvl[ch];
    g.fillRect(x, top + hh - lh, bw, lh);
    if (meterState.peak[ch] > 0) {
      g.fillStyle = meterState.peak[ch] > 0.98 ? '#ff4d5e' : '#e9ebf0';
      g.fillRect(x, top + hh - hh * meterState.peak[ch], bw, 2);
    }
  }
}
