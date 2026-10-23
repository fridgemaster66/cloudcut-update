'use strict';
/* premium.js — funkcje „pro”: efekty na karcie graficznej (LUT, kluczowanie), mikser,
   inteligentne narzędzia (cisza, sceny, rytm, ściszanie pod głosem, odwracanie) i napisy AI */

/* =========================================================
   WebGL2: LUT 3D i kluczowanie koloru na karcie graficznej
   ========================================================= */
let gl = null, glCanvas = null, glProg = null, glSrcTex = null, glOk = null, glU = null;
const glLuts = new Map(); // id -> { tex, size }
function initGL() {
  if (glOk !== null) return glOk;
  try {
    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true });
    if (!gl) return (glOk = false);
    const vs = `#version 300 es
      in vec2 p; out vec2 v;
      void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `#version 300 es
      precision highp float; precision highp sampler3D;
      in vec2 v; out vec4 o;
      uniform sampler2D src; uniform sampler3D lut;
      uniform vec4 crop; uniform bool useLut; uniform float lutAmt; uniform float lutSize;
      uniform bool useKey; uniform vec3 keyCol; uniform float tol; uniform float soft;
      uniform bool useFx; uniform vec2 texel; uniform float time; uniform float pxk;
      uniform float exposure, highlights, shadows, vibrance, sharpen, glow, grain, pixel, rgbs, glitch, wave, posterize;
      uniform vec4 tintS, tintH; uniform int mirror; uniform bool invert;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec4 tap(vec2 q) { return texture(src, vec2(crop.x + q.x * crop.z, crop.y + q.y * crop.w)); }
      void main() {
        vec2 q = v; // położenie w kadrze klipu 0–1 (y od dołu)
        float rs = 0.0;
        if (useFx) {
          if (mirror == 1 || mirror == 3) q.x = q.x < 0.5 ? q.x : 1.0 - q.x;
          if (mirror == 2 || mirror == 3) q.y = q.y > 0.5 ? q.y : 1.0 - q.y;
          if (wave > 0.0) q.x += sin(q.y * 22.0 + time * 5.0) * wave * 0.0005;
          if (glitch > 0.0) {
            float slot = floor(time * 14.0), band = floor(q.y * 28.0);
            if (hash(vec2(band, slot)) > 1.0 - glitch * 0.004) q.x += (hash(vec2(band + 7.0, slot)) - 0.5) * glitch * 0.003;
            rs += glitch * (hash(vec2(slot, 3.0)) > 0.7 ? 0.6 : 0.15);
          }
          if (pixel > 0.0) { vec2 cells = max(vec2(1.0), crop.zw / texel / pixel); q = (floor(q * cells) + 0.5) / cells; }
          q = clamp(q, 0.0, 1.0);
          rs += rgbs;
        }
        vec4 c = tap(q);
        if (useFx) {
          if (rs > 0.0) { vec2 d = vec2(rs * 0.5 * texel.x / crop.z, 0.0); c.r = tap(q + d).r; c.b = tap(q - d).b; }
          if (sharpen > 0.0) {
            vec2 dx = vec2(texel.x / crop.z, 0.0), dy = vec2(0.0, texel.y / crop.w);
            vec3 blur = (tap(q + dx).rgb + tap(q - dx).rgb + tap(q + dy).rgb + tap(q - dy).rgb) * 0.25;
            c.rgb += (c.rgb - blur) * sharpen * 0.03;
          }
        }
        float a = c.a;
        if (useKey) {
          vec3 p = c.rgb * 255.0, k = keyCol * 255.0;
          float cb = -0.1687 * p.r - 0.3313 * p.g + 0.5 * p.b, cr = 0.5 * p.r - 0.4187 * p.g - 0.0813 * p.b;
          float kcb = -0.1687 * k.r - 0.3313 * k.g + 0.5 * k.b, kcr = 0.5 * k.r - 0.4187 * k.g - 0.0813 * k.b;
          float d = distance(vec2(cb, cr), vec2(kcb, kcr));
          float t0 = tol * 1.3, s = max(1.0, soft * 1.3);
          float ka = clamp((d - t0) / s, 0.0, 1.0);
          if (ka < 1.0) {
            // rozlew koloru tła na krawędziach
            if (k.g >= k.r && k.g >= k.b) c.g = min(c.g, max(c.r, c.b));
            else if (k.b >= k.r) c.b = min(c.b, max(c.r, c.g));
            else c.r = min(c.r, max(c.g, c.b));
          }
          a *= ka;
        }
        if (useLut) {
          vec3 lc = clamp(c.rgb, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
          c.rgb = mix(c.rgb, texture(lut, lc).rgb, lutAmt);
        }
        if (useFx) {
          c.rgb *= exp2(exposure / 50.0);
          float L = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb += shadows / 100.0 * 0.45 * (1.0 - smoothstep(0.0, 0.55, L));
          c.rgb += highlights / 100.0 * 0.45 * smoothstep(0.45, 1.0, L);
          L = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
          c.rgb = mix(vec3(L), c.rgb, 1.0 + vibrance / 100.0 * (1.0 - clamp(sat, 0.0, 1.0)));
          c.rgb += (tintS.rgb - 0.5) * tintS.a * (1.0 - clamp(L, 0.0, 1.0)) * 0.7;
          c.rgb += (tintH.rgb - 0.5) * tintH.a * clamp(L, 0.0, 1.0) * 0.7;
          if (glow > 0.0) {
            vec3 g = vec3(0.0);
            for (int i = 0; i < 12; i++) {
              float an = float(i) * 0.5236, r = (glow * 0.35 + 2.0) * pxk * (1.0 + float(i % 3));
              g += max(tap(q + vec2(cos(an), sin(an)) * r * texel / crop.zw).rgb - 0.55, 0.0);
            }
            c.rgb += g / 12.0 * glow * 0.045;
          }
          if (posterize > 0.0) { float n = mix(24.0, 2.0, posterize / 100.0); c.rgb = floor(clamp(c.rgb, 0.0, 1.0) * n + 0.5) / n; }
          if (invert) c.rgb = 1.0 - c.rgb;
          if (grain > 0.0) c.rgb += (hash(gl_FragCoord.xy + fract(time * 23.0) * 91.0) - 0.5) * grain / 100.0 * 0.32;
          c.rgb = clamp(c.rgb, 0.0, 1.0);
        }
        o = vec4(c.rgb * a, a);
      }`;
    const sh = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    glProg = gl.createProgram();
    gl.attachShader(glProg, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(glProg, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(glProg);
    if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProg));
    gl.useProgram(glProg);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(glProg, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    glU = Object.fromEntries(['src', 'lut', 'crop', 'useLut', 'lutAmt', 'lutSize', 'useKey', 'keyCol', 'tol', 'soft',
      'useFx', 'texel', 'time', 'pxk', 'exposure', 'highlights', 'shadows', 'vibrance', 'sharpen', 'glow', 'grain', 'pixel', 'rgbs', 'glitch', 'wave',
      'posterize', 'tintS', 'tintH', 'mirror', 'invert'].map(n => [n, gl.getUniformLocation(glProg, n)]));
    glSrcTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glSrcTex);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    gl.uniform1i(glU.src, 0);
    gl.uniform1i(glU.lut, 1);
    glOk = true;
  } catch (err) {
    console.warn('WebGL2 niedostępny — efekty liczone na procesorze', err);
    glOk = false;
  }
  return glOk;
}
function glLutTexture(id) {
  if (glLuts.has(id)) return glLuts.get(id);
  const lut = getLut(id);
  if (!lut) return null;
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
  for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, val);
  const e = { tex, size: lut.size };
  glLuts.set(id, e);
  return e;
}
/* t: czas od początku klipu (ziarno, glitch i falowanie zmieniają się w czasie) */
function gpuEffects(src, sx, sy, cw, ch, P, t = 0) {
  if (!initGL()) return null;
  const lutE = P.lut?.id ? glLutTexture(P.lut.id) : null;
  const key = P.key?.on ? P.key : null;
  const e = efxActive(P.efx) ? P.efx : null;
  if (!lutE && !key && !e) return null;
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return null;
  const k = Math.min(1, 2048 / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glSrcTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }
  catch { return null; }
  // przy odwróconej osi Y kadr liczymy od dołu
  gl.uniform4f(glU.crop, sx / sw, 1 - (sy + ch) / sh, cw / sw, ch / sh);
  gl.uniform1i(glU.useLut, lutE ? 1 : 0);
  if (lutE) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutE.tex);
    gl.uniform1f(glU.lutAmt, clamp((P.lut.amount ?? 100) / 100, 0, 1));
    gl.uniform1f(glU.lutSize, lutE.size);
  }
  gl.uniform1i(glU.useKey, key ? 1 : 0);
  if (key) {
    const [r, g, b] = hexRgb(key.color);
    gl.uniform3f(glU.keyCol, r / 255, g / 255, b / 255);
    gl.uniform1f(glU.tol, key.tol);
    gl.uniform1f(glU.soft, key.soft);
  }
  gl.uniform1i(glU.useFx, e ? 1 : 0);
  if (e) {
    // efekty w pikselach liczymy względem kadru projektu, żeby wyglądały tak samo przy każdej rozdzielczości pliku
    const pk = Math.max(cw / state.w, ch / state.h, 0.05);
    gl.uniform2f(glU.texel, 1 / sw, 1 / sh);
    gl.uniform1f(glU.time, t);
    for (const n of ['exposure', 'highlights', 'shadows', 'vibrance', 'sharpen', 'grain', 'glitch', 'wave', 'posterize']) gl.uniform1f(glU[n], +e[n] || 0);
    gl.uniform1f(glU.glow, +e.glow || 0);
    gl.uniform1f(glU.pxk, pk);
    gl.uniform1f(glU.pixel, (+e.pixel || 0) * pk);
    gl.uniform1f(glU.rgbs, (+e.rgb || 0) * pk);
    const tint = (hex, amt) => { const [r, g, b] = hexRgb(hex || '#808080'); return [r / 255, g / 255, b / 255, clamp((+amt || 0) / 100, 0, 1)]; };
    gl.uniform4f(glU.tintS, ...tint(e.tintS, e.tintSAmt));
    gl.uniform4f(glU.tintH, ...tint(e.tintH, e.tintHAmt));
    gl.uniform1i(glU.mirror, { h: 1, v: 2, q: 3 }[e.mirror] || 0);
    gl.uniform1i(glU.invert, e.invert ? 1 : 0);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return glCanvas;
}

/* =========================================================
   Mikser audio
   ========================================================= */
let mixerDlg = null, mixerTimer = null;
function openMixer() {
  ensureAudio();
  syncBuses();
  if (!mixerDlg) {
    mixerDlg = document.createElement('dialog');
    mixerDlg.className = 'dlg xwide';
    mixerDlg.setAttribute('aria-labelledby', 'mixTitle');
    mixerDlg.innerHTML = `<div class="dlg-head"><h2 id="mixTitle">Mikser audio</h2><button type="button" class="btn small" id="mixReset">Wyzeruj</button></div>
      <p class="hint">Głośność i panorama całych ścieżek. Wskaźniki pokazują poziom podczas odtwarzania (spacja odtwarza w tle).</p>
      <div class="mixer" id="mixStrips"></div>
      <div class="dlg-actions"><button type="button" class="btn primary" id="mixClose">Gotowe</button></div>`;
    document.body.appendChild(mixerDlg);
    mixerDlg.querySelector('#mixClose').addEventListener('click', () => mixerDlg.close());
    mixerDlg.querySelector('#mixReset').addEventListener('click', () => { for (const t of state.tracks) { t.vol = 1; t.pan = 0; } commit(); syncBuses(); renderMixer(); renderHeads(); });
    mixerDlg.addEventListener('close', () => { clearInterval(mixerTimer); renderHeads(); });
    mixerDlg.addEventListener('input', e => {
      const el = e.target, tr = state.tracks.find(t => t.id === el.dataset.tr);
      if (!tr) return;
      tr[el.dataset.k] = +el.value;
      syncBuses();
      const o = mixerDlg.querySelector(`#mo-${el.dataset.k}-${tr.id}`);
      if (o) o.textContent = el.dataset.k === 'vol' ? (tr.vol > 0 ? (20 * Math.log10(tr.vol)).toFixed(1).replace('.', ',') + ' dB' : '−∞') : panLabel(tr.pan);
    });
    mixerDlg.addEventListener('change', () => commit());
    mixerDlg.addEventListener('click', e => {
      const b = e.target.closest('[data-mk]');
      if (!b) return;
      const tr = state.tracks.find(t => t.id === b.dataset.tr);
      tr[b.dataset.mk] = !tr[b.dataset.mk];
      commit(); renderMixer(); renderHeads(); syncMedia();
    });
  }
  renderMixer();
  mixerDlg.showModal();
  clearInterval(mixerTimer);
  const buf = new Float32Array(512);
  mixerTimer = setInterval(() => {
    for (const cv of mixerDlg.querySelectorAll('canvas[data-meter]')) {
      const b = buses.get(cv.dataset.meter);
      let p = 0;
      if (b && playing) { b.an.getFloatTimeDomainData(buf); for (const v of buf) p = Math.max(p, Math.abs(v)); }
      const lvl = clamp((20 * Math.log10(p || 1e-5) + 60) / 60, 0, 1);
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#1a1d24'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = lvl > 0.95 ? '#ff4d5e' : lvl > 0.85 ? '#f2c94c' : '#2fbf71';
      g.fillRect(0, cv.height * (1 - lvl), cv.width, cv.height * lvl);
    }
  }, 60);
}
const panLabel = p => (Math.abs(p) < 0.02 ? 'środek' : p < 0 ? `L ${Math.round(-p * 100)}` : `P ${Math.round(p * 100)}`);
function renderMixer() {
  const tracks = state.tracks.filter(t => t.kind !== 'text');
  mixerDlg.querySelector('#mixStrips').innerHTML = tracks.map(tr => `<div class="mix-strip">
      <div class="mix-name" title="${esc(tr.name)}">${esc(tr.name)}</div>
      <div class="mix-fader">
        <canvas data-meter="${tr.id}" width="10" height="160" aria-hidden="true"></canvas>
        <input type="range" class="vfader" aria-label="Głośność ${esc(tr.name)}" data-tr="${tr.id}" data-k="vol" min="0" max="2" step="0.01" value="${tr.vol ?? 1}">
      </div>
      <output id="mo-vol-${tr.id}">${(tr.vol ?? 1) > 0 ? (20 * Math.log10(tr.vol ?? 1)).toFixed(1).replace('.', ',') + ' dB' : '−∞'}</output>
      <label class="sr-only" for="pan-${tr.id}">Panorama ${esc(tr.name)}</label>
      <input type="range" id="pan-${tr.id}" data-tr="${tr.id}" data-k="pan" min="-1" max="1" step="0.01" value="${tr.pan ?? 0}">
      <output id="mo-pan-${tr.id}">${panLabel(tr.pan ?? 0)}</output>
      <div class="mix-btns">
        <button type="button" class="icon-btn" data-mk="muted" data-tr="${tr.id}" aria-pressed="${tr.muted}" title="Wycisz">M</button>
        ${tr.kind === 'audio' ? `<button type="button" class="icon-btn solo" data-mk="solo" data-tr="${tr.id}" aria-pressed="${tr.solo}" title="Solo">S</button>` : ''}
      </div></div>`).join('');
}

/* =========================================================
   Analiza dźwięku
   ========================================================= */
/* Głośność (RMS) co `hop` sekund w zakresie czasu pliku */
function rmsEnvelope(buf, from, to, hop = 0.02) {
  const sr = buf.sampleRate, ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
  const n = Math.max(0, Math.floor((to - from) / hop));
  const out = new Float32Array(n), win = Math.max(1, Math.floor(hop * sr));
  for (let i = 0; i < n; i++) {
    const a = Math.floor((from + i * hop) * sr);
    let s = 0, cnt = 0;
    for (let j = a; j < a + win && j < buf.length; j += 2) { for (const d of ch) s += d[j] * d[j]; cnt += ch.length; }
    out[i] = cnt ? Math.sqrt(s / cnt) : 0;
  }
  return out;
}
const audioPartner = c => (c.kind === 'audio' ? c : groupMembers(c).find(x => x.kind === 'audio') || c);

/* ---------------- Usuwanie ciszy ---------------- */
const REV_NOTE = 'Ta funkcja działa na klipach odtwarzanych do przodu — ustaw dodatnią prędkość';
async function removeSilence() {
  const base = selectedClips().find(c => isAV(c) && !isLocked(c));
  if (!base) { toast('Zaznacz klip z mową (wideo albo audio), z którego usunąć ciszę'); return; }
  const ac = audioPartner(base);
  if (ac.speed < 0) { toast(REV_NOTE); return; }
  const buf = await decodedBuffer(ac.mediaId);
  if (!buf) { toast('Nie udało się odczytać dźwięku tego klipu'); return; }
  const hop = 0.02, minSil = 0.45, pad = 0.12;
  const from = ac.in, to = ac.in + ac.dur * ac.speed;
  const env = rmsEnvelope(buf, from, to, hop);
  const peak = Math.max(...env, 1e-4);
  const thr = Math.max(0.006, peak * 0.06); // około −24 dB poniżej najgłośniejszego miejsca
  const keep = [];
  let runStart = null;
  for (let i = 0; i <= env.length; i++) {
    const silent = i < env.length && env[i] < thr;
    if (silent && runStart === null) runStart = i;
    if ((!silent || i === env.length) && runStart !== null) {
      const len = (i - runStart) * hop;
      if (len >= minSil) keep.push([from + runStart * hop + pad, from + i * hop - pad]);
      runStart = null;
    }
  }
  // zamiana listy cisz na fragmenty do zachowania (czas pliku)
  const segs = [];
  let cur = from;
  for (const [a, b] of keep) { if (a > cur + 0.05) segs.push([cur, a]); cur = Math.max(cur, b); }
  if (to > cur + 0.05) segs.push([cur, to]);
  if (segs.length <= 1 && keep.length === 0) { toast('Nie znaleziono cisz dłuższych niż 0,45 s'); return; }
  const members = groupMembers(base).filter(x => isAV(x) && Math.abs(x.start - base.start) < EPS && Math.abs(x.dur - base.dur) < EPS);
  const oldEnd = clipEnd(base);
  let total = 0;
  const newSel = new Set();
  for (const [a, b] of segs) {
    const g = members.length > 1 ? uid('g') : null;
    for (const m of members) {
      const piece = structuredClone(m);
      piece.id = uid('c');
      piece.in = m.in + (a - from) * (m.speed / ac.speed);
      piece.start = base.start + total;
      piece.dur = (b - a) / ac.speed;
      piece.group = g;
      piece.kf = {};
      piece.props.fadeIn = Math.min(0.03, piece.dur / 4); piece.props.inType = 'fade';
      piece.props.fadeOut = Math.min(0.03, piece.dur / 4);
      state.clips.push(piece);
      newSel.add(piece.id);
    }
    total += (b - a) / ac.speed;
  }
  const removed = base.dur - total;
  const memberIds = new Set(members.map(m => m.id));
  const tracks = new Set(members.map(m => m.trackId));
  state.clips = state.clips.filter(c => !memberIds.has(c.id));
  for (const c of state.clips) if (tracks.has(c.trackId) && !newSel.has(c.id) && c.start >= oldEnd - EPS) c.start -= removed;
  sel = newSel;
  gcPlayers();
  commit(); renderAll();
  toast(`Usunięto ${keep.length} cisz — film krótszy o ${removed.toFixed(1).replace('.', ',')} s (Ctrl+Z cofa)`, 4500);
}

/* ---------------- Wykrywanie rytmu ---------------- */
async function detectBeats() {
  const base = selectedClips().find(isAV) || state.clips.find(c => c.kind === 'audio');
  if (!base) { toast('Zaznacz klip z muzyką'); return; }
  const ac = audioPartner(base);
  if (ac.speed < 0) { toast(REV_NOTE); return; }
  const buf = await decodedBuffer(ac.mediaId);
  if (!buf) { toast('Nie udało się odczytać dźwięku'); return; }
  const hop = 0.01, from = ac.in, to = ac.in + ac.dur * ac.speed;
  const env = rmsEnvelope(buf, from, to, hop);
  const beats = [];
  const win = 100; // 1 s średniej
  let last = -1;
  for (let i = 1; i < env.length - 1; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - win); j < Math.min(env.length, i + win / 4); j++) { s += env[j]; n++; }
    const avg = s / n;
    if (env[i] > avg * 1.45 && env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.02 && (last < 0 || (i - last) * hop >= 0.28)) {
      beats.push(i * hop);
      last = i;
    }
  }
  if (!beats.length) { toast('Nie wykryto wyraźnego rytmu'); return; }
  let added = 0;
  for (const b of beats) {
    const t = ac.start + b / ac.speed;
    if (!state.markers.some(m => Math.abs(m.t - t) < 0.05)) { state.markers.push({ id: uid('k'), t, label: '♪' }); added++; }
  }
  state.markers.sort((a, b) => a.t - b.t);
  const bpm = beats.length > 3 ? Math.round(60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1))) : null;
  commit(); drawRuler();
  toast(`Dodano ${added} znaczników rytmu${bpm ? ` (ok. ${bpm} BPM)` : ''}. „Przetnij na znacznikach” pocina klipy w rytm muzyki.`, 5000);
}
function splitAtMarkers() {
  const marks = state.markers.map(m => m.t).sort((a, b) => a - b);
  if (!marks.length) { toast('Najpierw dodaj znaczniki (M) albo wykryj rytm'); return; }
  const base = selectedClips().length ? selectedClips().flatMap(groupMembers) : state.clips.filter(c => laneKind(c.kind) === 'video');
  // nowe części po każdym cięciu też biorą udział w kolejnych cięciach
  const eligible = new Set(base.filter(c => !isLocked(c)).map(c => c.id));
  let n = 0;
  for (const t of marks) {
    const groups = new Map();
    for (const c of state.clips.filter(x => eligible.has(x.id) && t > x.start + EPS && t < clipEnd(x) - EPS)) {
      const r = splitClip(c, t);
      if (c.group) { if (!groups.has(c.group)) groups.set(c.group, uid('g')); r.group = groups.get(c.group); }
      eligible.add(r.id);
      n++;
    }
  }
  commit(); renderAll();
  toast(n ? `Przecięto w ${n} miejscach` : 'Żaden znacznik nie wypada w środku klipu');
}

/* ---------------- Ściszanie muzyki pod głosem (ducking) ---------------- */
async function autoDuck() {
  const music = selectedClips().filter(c => c.kind === 'audio' && !isLocked(c));
  if (!music.length) { toast('Zaznacz klip(y) z muzyką — program ściszy je tam, gdzie ktoś mówi'); return; }
  const musicIds = new Set(music.flatMap(c => groupMembers(c).map(x => x.id)));
  const voices = state.clips.filter(c => isAV(c) && !musicIds.has(c.id) && !c.off && trackAudible(trackOf(c)) && !(c.kind === 'video' && c.props.detached));
  if (!voices.length) { toast('Brak innych klipów z dźwiękiem (głosem), pod którymi ściszać'); return; }
  const hop = 0.05;
  const start = Math.min(...music.map(c => c.start)), end = Math.max(...music.map(clipEnd));
  const n = Math.ceil((end - start) / hop);
  const act = new Uint8Array(n);
  for (const v of voices) {
    const a = Math.max(v.start, start), b = Math.min(clipEnd(v), end);
    if (b <= a) continue;
    const buf = await decodedBuffer(v.mediaId);
    if (!buf) continue;
    const p0 = v.in + (a - v.start) * v.speed, p1 = v.in + (b - v.start) * v.speed;
    let env = rmsEnvelope(buf, Math.min(p0, p1), Math.max(p0, p1), hop * Math.abs(v.speed));
    if (v.speed < 0) env = env.reverse(); // głos odtwarzany wstecz
    const vol = v.props.volume ?? 1;
    for (let i = 0; i < env.length; i++) if (env[i] * vol > 0.025) act[Math.floor((a - start) / hop) + i] = 1;
  }
  // przytrzymanie: krótkie przerwy w mowie nie podgłaśniają muzyki
  const hold = Math.round(0.6 / hop);
  for (let i = 0, lastOn = -1e9; i < n; i++) { if (act[i]) lastOn = i; else if (i - lastOn <= hold) act[i] = 2; }
  let total = 0;
  for (const c of music) {
    const base = c.props.volume ?? 1, low = base * 0.22, ramp = 0.3;
    const pts = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      const t = start + i * hop;
      if (t < c.start || t > clipEnd(c)) continue;
      const on = act[i] > 0;
      if (prev === null) { pts.push({ t: t - c.start, v: on ? low : base }); prev = on; continue; }
      if (on !== prev) {
        const lt = t - c.start;
        pts.push({ t: Math.max(0, lt - ramp), v: prev ? low : base }, { t: lt, v: on ? low : base });
        prev = on;
        total++;
      }
    }
    pts.push({ t: c.dur, v: prev ? low : base });
    const clean = [];
    for (const p of pts.sort((a, b) => a.t - b.t)) if (!clean.length || p.t - clean[clean.length - 1].t > 0.01) clean.push({ t: Math.round(p.t * 1000) / 1000, v: Math.round(p.v * 1000) / 1000 });
    c.kf ??= {};
    c.kf.volume = clean;
  }
  commit(); renderAll();
  toast(total ? `Muzyka ściszy się pod głosem w ${Math.ceil(total / 2)} miejscach (ok. −13 dB)` : 'Nie wykryto mowy w czasie trwania muzyki', 4500);
}

/* ---------------- Wyrównanie głośności ---------------- */
function normalizeAll() {
  let n = 0;
  for (const c of state.clips) {
    if (!isAV(c) || (c.kind === 'video' && c.props.detached)) continue;
    const m = media.get(c.mediaId);
    if (!m?.peak) continue;
    delete c.kf.volume;
    c.props.volume = Math.round(clamp(0.89 / m.peak, 0, 4) * 100) / 100; // szczyt −1 dB
    n++;
  }
  if (!n) { toast('Brak klipów z dźwiękiem'); return; }
  commit(); renderAll();
  toast(`Wyrównano głośność ${n} klipów (szczyty −1 dB)`);
}

/* ---------------- Mediabunny (dekodowanie / kodowanie) ---------------- */
let MB = null;
async function loadMediabunny() {
  if (!MB) MB = await import('mediabunny');
  return MB;
}

/* ---------------- Wykrywanie scen ---------------- */
async function detectScenes() {
  const c = selectedClips().find(x => x.kind === 'video' && !isLocked(x));
  if (!c) { toast('Zaznacz klip wideo, w którym wykryć zmiany ujęć'); return; }
  if (c.speed < 0) { toast(REV_NOTE); return; }
  const m = media.get(c.mediaId);
  toast('Analizuję obraz…', 2000);
  const step = 1 / 6, from = c.in, to = c.in + c.dur * c.speed;
  const times = [];
  for (let t = from; t < to; t += step) times.push(t);
  const thumbs = [];
  const sm = document.createElement('canvas');
  sm.width = 32; sm.height = 18;
  const sg = sm.getContext('2d', { willReadFrequently: true });
  // pełny kolor, nie sama jasność — np. czerwień i zieleń mają podobną jasność, a to inne ujęcia
  const grab = src => { sg.drawImage(src, 0, 0, 32, 18); const d = sg.getImageData(0, 0, 32, 18).data; const g = new Float32Array(1728); for (let i = 0; i < 576; i++) { g[i * 3] = d[i * 4]; g[i * 3 + 1] = d[i * 4 + 1]; g[i * 3 + 2] = d[i * 4 + 2]; } return g; };
  try {
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new mb.CanvasSink(track, { width: 64, height: 36, fit: 'fill' });
    for await (const w of sink.canvasesAtTimestamps(times)) thumbs.push(w ? grab(w.canvas) : null);
  } catch (err) {
    // zapas: przewijanie elementu wideo
    console.warn('Mediabunny niedostępny, przewijam wideo', err);
    const v = document.createElement('video');
    v.muted = true; v.src = m.url;
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; });
    for (const t of times) { await seekTo(v, t); thumbs.push(grab(v)); }
    v.removeAttribute('src'); v.load();
  }
  const cuts = [];
  let lastCut = -1;
  for (let i = 1; i < thumbs.length; i++) {
    const a = thumbs[i - 1], b = thumbs[i];
    if (!a || !b) continue;
    let d = 0;
    for (let j = 0; j < 1728; j++) d += Math.abs(a[j] - b[j]);
    d /= 1728 * 255;
    if (d > 0.14 && (lastCut < 0 || (i - lastCut) * step > 0.7)) { cuts.push(times[i]); lastCut = i; }
  }
  if (!cuts.length) { toast('Nie wykryto zmian ujęć w tym klipie'); return; }
  const members = groupMembers(c);
  for (const st of cuts) {
    const t = c.start + (st - c.in) / c.speed;
    const parts = members.map(x => state.clips.find(y => y.trackId === x.trackId && t > y.start + EPS && t < clipEnd(y) - EPS)).filter(Boolean);
    const g = parts.length > 1 ? uid('g') : null;
    for (const p of parts) { const r = splitClip(p, t); if (g) r.group = g; }
  }
  commit(); renderAll();
  toast(`Wykryto ${cuts.length} zmian ujęć — klip pocięty na ${cuts.length + 1} części`);
}

/* ---------------- Odwracanie klipu ---------------- */
/* Od końca = prędkość ujemna: działa od razu, bez tworzenia nowego pliku i bez limitu długości */
function reverseClip() {
  const c = selectedClips().find(x => isAV(x) && !isLocked(x));
  if (!c) { toast('Zaznacz klip wideo lub audio do odwrócenia'); return; }
  setSpeed(c, -c.speed);
  commit(); renderAll();
  toast(c.speed < 0 ? 'Klip odtwarza się teraz od końca' : 'Klip odtwarza się znowu do przodu');
}
/* Postęp długich operacji w dymku */
function progressToast(title) {
  return (p, msg) => toast(`${title} ${Math.round(clamp(p, 0, 1) * 100)}%${msg ? ' — ' + msg : ''}`, p >= 1 ? 1500 : 60000);
}

/* =========================================================
   Napisy AI (Whisper w przeglądarce)
   ========================================================= */
const ASR_MODELS = [
  ['onnx-community/whisper-tiny', 'Szybki — ok. 40 MB'],
  ['onnx-community/whisper-base', 'Dokładniejszy — ok. 80 MB'],
  ['onnx-community/whisper-small', 'Najdokładniejszy — ok. 250 MB'],
];
let capDlg = null, asrPipe = null, asrModel = null;
function openCaptions() {
  if (!capDlg) {
    capDlg = document.createElement('dialog');
    capDlg.className = 'dlg';
    capDlg.setAttribute('aria-labelledby', 'capTitle');
    capDlg.innerHTML = `<h2 id="capTitle">Automatyczne napisy (AI)</h2>
      <p class="hint">Rozpoznawanie mowy działa na Twoim komputerze — nagrania nie są nigdzie wysyłane. Za pierwszym razem pobierze się model (raz, potem jest w pamięci przeglądarki).</p>
      <div class="field"><label for="capModel">Model</label><select id="capModel">${ASR_MODELS.map(([v, l], i) => `<option value="${v}"${i === 1 ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label for="capLang">Język mowy</label><select id="capLang"><option value="polish">polski</option><option value="english">angielski</option><option value="german">niemiecki</option><option value="ukrainian">ukraiński</option><option value="">wykryj sam</option></select></div>
        <div class="field"><label for="capScope">Zakres</label><select id="capScope"><option value="all">Cały projekt</option><option value="io">Zakres I–O</option><option value="sel">Zaznaczone klipy</option></select></div>
      </div>
      <div class="field"><label for="capStyle">Styl napisów</label><select id="capStyle"><option value="subs">Napisy dialogowe (na dole)</option><option value="reel">Napisy do rolki (duże, na środku)</option></select></div>
      <div class="progress" id="capProg" hidden><div class="bar" id="capBar"></div></div>
      <p class="hint" id="capStatus" aria-live="polite"></p>
      <div class="dlg-actions"><button type="button" class="btn" id="capClose">Zamknij</button><button type="button" class="btn primary" id="capStart">Utwórz napisy</button></div>`;
    document.body.appendChild(capDlg);
    capDlg.querySelector('#capClose').addEventListener('click', () => capDlg.close());
    capDlg.querySelector('#capStart').addEventListener('click', runCaptions);
  }
  capDlg.querySelector('#capScope [value="io"]').disabled = !state.range;
  capDlg.querySelector('#capScope [value="sel"]').disabled = !selectedClips().some(isAV);
  capDlg.showModal();
}
async function runCaptions() {
  const st = capDlg.querySelector('#capStatus'), bar = capDlg.querySelector('#capBar');
  const btn = capDlg.querySelector('#capStart');
  const set = (p, msg) => { capDlg.querySelector('#capProg').hidden = false; bar.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%'; if (msg) st.textContent = msg; };
  btn.disabled = true;
  try {
    const scope = capDlg.querySelector('#capScope').value;
    let from = 0, to = projectEnd();
    if (scope === 'io' && state.range) { from = state.range.in; to = state.range.out; }
    if (scope === 'sel') { const s = selectedClips().filter(isAV); from = Math.min(...s.map(c => c.start)); to = Math.max(...s.map(clipEnd)); }
    if (to - from < 0.5) throw new Error('za krótki zakres');
    set(0.02, 'Przygotowanie dźwięku…');
    const mix = await renderAudioMix(from, to, 48000);
    // Whisper potrzebuje 16 kHz mono
    const off = new OfflineAudioContext(1, Math.ceil(mix.duration * 16000), 16000);
    const s = off.createBufferSource(); s.buffer = mix; s.connect(off.destination); s.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    let peak = 0; for (let i = 0; i < pcm.length; i += 16) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak < 0.003) throw new Error('w tym zakresie nie ma słyszalnego dźwięku');
    const model = capDlg.querySelector('#capModel').value;
    if (!asrPipe || asrModel !== model) {
      set(0.05, 'Wczytywanie modelu rozpoznawania mowy…');
      const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js');
      const files = new Map();
      // wersja skwantyzowana (q8) na procesorze: kilkukrotnie mniejsze pobieranie niż pełna wersja pod WebGPU
      asrPipe = await tf.pipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: p => {
          if (p.status === 'progress' && p.total) {
            files.set(p.file, [p.loaded, p.total]);
            const [l, t] = [...files.values()].reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
            set(0.05 + 0.45 * l / t, `Pobieranie modelu: ${(l / 1048576).toFixed(0)} z ${(t / 1048576).toFixed(0)} MB`);
          }
        },
      });
      asrModel = model;
    }
    set(0.55, `Rozpoznawanie mowy (${shortDur(to - from)} nagrania)…`);
    const lang = capDlg.querySelector('#capLang').value;
    const res = await asrPipe(pcm, { task: 'transcribe', ...(lang ? { language: lang } : {}), return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, no_repeat_ngram_size: 4 });
    // Whisper na muzyce lub szumie potrafi „zmyślać” zapętlone frazy — takie fragmenty odrzucamy
    const looksReal = txt => {
      const words = txt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
      if (!words.length) return false;
      if (words.length < 6) return true;
      return new Set(words).size / words.length >= 0.4;
    };
    const all = (res.chunks || []).filter(ch => ch.text?.trim());
    const chunks = all.filter(ch => looksReal(ch.text));
    if (!chunks.length) throw new Error(all.length ? 'w nagraniu nie wykryto wyraźnej mowy (odrzucono zapętlone fragmenty, które model zmyślił z muzyki lub szumu)' : 'nie rozpoznano mowy');
    const tr = mkTrack(uid('t'), 'text', 'Napisy AI');
    state.tracks.unshift(tr);
    const preset = TITLE_PRESETS.find(p => p.key === capDlg.querySelector('#capStyle').value);
    let n = 0;
    for (const ch of chunks) {
      const [a, b] = ch.timestamp;
      const s0 = from + (a ?? 0), e0 = from + (b ?? (a + 3));
      if (!(e0 > s0)) continue;
      // długie zdania dzielimy na krótsze plansze (do ~42 znaków)
      const words = ch.text.trim().split(/\s+/);
      const parts = [];
      let cur = '';
      for (const w of words) { if ((cur + ' ' + w).trim().length > 42 && cur) { parts.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
      if (cur) parts.push(cur);
      const per = (e0 - s0) / parts.length;
      parts.forEach((p, i) => {
        const c = newClip('text', tr.id, s0 + i * per, Math.max(frame(), per), { name: 'Napis' });
        Object.assign(c.props, preset.p(state.w, state.h), { text: p, fadeIn: 0, fadeOut: 0 });
        state.clips.push(c);
        n++;
      });
    }
    commit(); renderAll();
    const dropped = all.length - chunks.length;
    set(1, `Gotowe — ${n} napisów na ścieżce „Napisy AI”${dropped ? ` (pominięto ${dropped} podejrzanych fragmentów)` : ''}. Sprawdź je i popraw, jeśli trzeba.`);
  } catch (err) {
    console.error(err);
    st.textContent = 'Nie udało się utworzyć napisów: ' + err.message;
  } finally { btn.disabled = false; }
}

/* =========================================================
   Menu „Pro” na pasku osi czasu
   ========================================================= */
function openProMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: '✦ Automatyczne napisy (AI)…', key: keyLabel('captions'), act: openCaptions },
    { label: 'Usuń ciszę z zaznaczonego klipu', key: keyLabel('silence'), act: removeSilence },
    { label: 'Wykryj zmiany ujęć i potnij', act: detectScenes },
    { label: 'Wykryj rytm muzyki (znaczniki)', act: detectBeats },
    { label: 'Przetnij na znacznikach', act: splitAtMarkers },
    { label: 'Ścisz muzykę pod głosem (ducking)', act: autoDuck },
    { label: 'Wyrównaj głośność wszystkich klipów', act: normalizeAll },
    { label: 'Odwróć klip (od końca)', act: reverseClip },
    { label: 'Rozdziały YouTube ze znaczników…', act: showChapters },
    { label: 'Wskaźniki obrazu (histogram, wektorskop)…', act: toggleScopes },
    '-',
    { label: 'Mikser audio…', key: keyLabel('mixer'), act: openMixer },
    { label: 'Importuj LUT (.cube)…', act: () => $('#lutInput').click() },
    { label: 'Dodaj bieżącą klatkę do mediów', act: frameToBin },
  ]);
}
async function frameToBin() {
  const prev = renderScale;
  setRenderScale(1);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  setRenderScale(prev);
  const m = await importBlob(blob, `Klatka ${tc(playhead).replace(/:/g, '-')}.png`);
  if (m) toast('Klatka jest w mediach jako obraz');
}
