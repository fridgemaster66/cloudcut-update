'use strict';
/* scopes.js — wskaźniki jak w Lumetri Scopes (Premiere): histogram RGB, przebieg jasności, parada RGB i wektorskop.
   Czytają pomniejszony podgląd programu kilka razy na sekundę, także podczas odtwarzania. */

const SC_W = 160, SC_H = 90; // próbka podglądu: 14 400 pikseli wystarcza do wiarygodnych wykresów
const scopes = { el: null, timer: 0, mode: 'all', sample: null, sctx: null };
const SCOPE_MODES = [['all', 'Wszystkie'], ['hist', 'Histogram'], ['wave', 'Przebieg (jasność)'], ['parade', 'Parada RGB'], ['vector', 'Wektorskop']];

function toggleScopes() {
  if (scopes.el && !scopes.el.hidden) { closeScopes(); return; }
  if (!scopes.el) buildScopes();
  try { scopes.mode = localStorage.getItem('cloudcut-scopes') || 'all'; } catch { /* bez zapisu */ }
  if (!SCOPE_MODES.some(m => m[0] === scopes.mode)) scopes.mode = 'all';
  $('#scMode').value = scopes.mode;
  scopes.el.hidden = false;
  $('#btnScopes').setAttribute('aria-pressed', 'true');
  scopesTick();
}
function closeScopes() {
  clearTimeout(scopes.timer);
  if (scopes.el) scopes.el.hidden = true;
  $('#btnScopes')?.setAttribute('aria-pressed', 'false');
}
function buildScopes() {
  const d = document.createElement('section');
  d.className = 'scopes';
  d.id = 'scopesPanel';
  d.setAttribute('aria-labelledby', 'scTitle');
  d.hidden = true;
  d.innerHTML = `<div class="sc-head"><h2 id="scTitle">Wskaźniki</h2>
      <label class="sr-only" for="scMode">Rodzaj wskaźnika</label>
      <select id="scMode">${SCOPE_MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button type="button" class="icon-btn" id="scClose" aria-label="Zamknij wskaźniki" title="Zamknij">✕</button></div>
    <canvas id="scCanvas" width="680" height="440" role="img" aria-label="Wskaźniki obrazu"></canvas>
    <p class="sc-info" id="scInfo" aria-live="off"></p>`;
  document.body.appendChild(d);
  scopes.el = d;
  scopes.sample = document.createElement('canvas');
  scopes.sample.width = SC_W; scopes.sample.height = SC_H;
  scopes.sctx = scopes.sample.getContext('2d', { willReadFrequently: true });
  $('#scClose').addEventListener('click', closeScopes);
  $('#scMode').addEventListener('change', e => {
    scopes.mode = e.target.value;
    try { localStorage.setItem('cloudcut-scopes', scopes.mode); } catch { /* bez zapisu */ }
    drawScopes();
  });
}
function scopesTick() {
  clearTimeout(scopes.timer);
  if (!scopes.el || scopes.el.hidden) return;
  drawScopes();
  scopes.timer = setTimeout(scopesTick, playing ? 120 : 400);
}

/* Odczyt pikseli podglądu → wykresy */
function drawScopes() {
  const sctx = scopes.sctx;
  sctx.drawImage(canvas, 0, 0, SC_W, SC_H);
  const px = sctx.getImageData(0, 0, SC_W, SC_H).data;
  const cv = $('#scCanvas'), g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#0b0d11';
  g.fillRect(0, 0, W, H);
  const mode = scopes.mode;
  const boxes = mode === 'all'
    ? { hist: [0, 0, W / 2, H / 2], wave: [W / 2, 0, W / 2, H / 2], parade: [0, H / 2, W / 2, H / 2], vector: [W / 2, H / 2, W / 2, H / 2] }
    : { [mode]: [0, 0, W, H] };
  if (boxes.hist) scopeHist(g, px, ...boxes.hist);
  if (boxes.wave) scopeWave(g, px, ...boxes.wave, false);
  if (boxes.parade) scopeWave(g, px, ...boxes.parade, true);
  if (boxes.vector) scopeVector(g, px, ...boxes.vector);
  if (mode === 'all') {
    g.strokeStyle = '#2b303b'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  }
  // przepalenia i zbite czernie — najczęstsze błędy ekspozycji
  let hi = 0, lo = 0;
  for (let i = 0; i < px.length; i += 4) { const y = luma(px[i], px[i + 1], px[i + 2]); if (y > 250) hi++; else if (y < 5) lo++; }
  const n = px.length / 4, pct = v => (v / n * 100).toFixed(1).replace('.', ',') + '%';
  const info = `Przepalone: ${pct(hi)} · Zbite czernie: ${pct(lo)}${hi / n > 0.02 ? ' — zmniejsz ekspozycję albo światła' : lo / n > 0.08 ? ' — podnieś cienie' : ''}`;
  if ($('#scInfo').textContent !== info) $('#scInfo').textContent = info;
}
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function scopeLabel(g, text, x, y) {
  g.font = '600 18px Inter, system-ui, sans-serif';
  g.fillStyle = 'rgba(230,233,240,.75)';
  g.fillText(text, x + 10, y + 24);
}
function scopeHist(g, px, x, y, w, h) {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < px.length; i += 4) { bins[0][px[i]]++; bins[1][px[i + 1]]++; bins[2][px[i + 2]]++; }
  let max = 1;
  for (const b of bins) for (let i = 2; i < 254; i++) max = Math.max(max, b[i]); // skrajne słupki nie spłaszczają reszty
  g.save();
  g.globalCompositeOperation = 'lighter';
  const pad = 10, iw = w - pad * 2, ih = h - 44;
  ['rgba(255,70,70,.75)', 'rgba(70,230,110,.75)', 'rgba(80,140,255,.8)'].forEach((col, ch) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x + pad, y + h - 10);
    for (let i = 0; i < 256; i++) g.lineTo(x + pad + i / 255 * iw, y + h - 10 - Math.min(1, Math.sqrt(bins[ch][i] / max)) * ih);
    g.lineTo(x + pad + iw, y + h - 10);
    g.closePath();
    g.fill();
  });
  g.restore();
  scopeLabel(g, 'Histogram', x, y);
}
function scopeWave(g, px, x, y, w, h, parade) {
  const cols = parade ? 3 : 1, pad = 10, top = 34, ih = h - top - 10, cw = (w - pad * 2) / cols;
  const img = g.createImageData(Math.max(1, Math.round(w - pad * 2)), Math.max(1, Math.round(ih)));
  const acc = new Uint16Array(img.width * img.height * 3);
  for (let yy = 0; yy < SC_H; yy++) for (let xx = 0; xx < SC_W; xx++) {
    const i = (yy * SC_W + xx) * 4;
    const vals = parade ? [px[i], px[i + 1], px[i + 2]] : [luma(px[i], px[i + 1], px[i + 2])];
    for (let c = 0; c < cols; c++) {
      const ox = Math.min(img.width - 1, Math.floor(c * cw + xx / SC_W * (cw - 4)));
      const oy = Math.min(img.height - 1, Math.floor((1 - vals[c] / 255) * (img.height - 1)));
      acc[(oy * img.width + ox) * 3 + (parade ? c : 1)]++;
    }
  }
  for (let p = 0, q = 0; p < acc.length; p += 3, q += 4) {
    const r = acc[p], gg = acc[p + 1], b = acc[p + 2];
    if (!r && !gg && !b) continue;
    if (parade) { img.data[q] = Math.min(255, r * 70); img.data[q + 1] = Math.min(255, gg * 70); img.data[q + 2] = Math.min(255, b * 90); }
    else { img.data[q] = Math.min(255, gg * 40); img.data[q + 1] = Math.min(255, 60 + gg * 70); img.data[q + 2] = Math.min(255, gg * 40); }
    img.data[q + 3] = 255;
  }
  // siatka 0–100 (IRE) pod wykresem
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
  g.font = '12px ui-monospace, Consolas, monospace'; g.fillStyle = 'rgba(255,255,255,.4)';
  for (const v of [0, 25, 50, 75, 100]) {
    const yy = y + top + (1 - v / 100) * (ih - 1);
    g.beginPath(); g.moveTo(x + pad, yy); g.lineTo(x + w - pad, yy); g.stroke();
    g.fillText(String(v), x + w - pad - 24, yy - 3);
  }
  g.putImageData(img, Math.round(x + pad), Math.round(y + top));
  scopeLabel(g, parade ? 'Parada RGB' : 'Przebieg', x, y);
}
function scopeVector(g, px, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2 + 10, R = Math.min(w, h - 30) / 2 - 8;
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  // linia odcieni skóry (ok. 123°) — twarze powinny leżeć blisko niej
  const sk = -123 * Math.PI / 180;
  g.strokeStyle = 'rgba(255,190,140,.45)';
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sk) * R, cy + Math.sin(sk) * R); g.stroke();
  const pos = (r, gg, b) => {
    const yv = luma(r, gg, b), cb = (b - yv) / 1.8556 / 255, cr = (r - yv) / 1.5748 / 255;
    return [cx + cb * R * 2, cy - cr * R * 2];
  };
  // cele barw podstawowych (75%)
  g.font = '600 12px Inter, system-ui, sans-serif';
  for (const [n, rgb] of [['R', [191, 0, 0]], ['Mg', [191, 0, 191]], ['B', [0, 0, 191]], ['Cy', [0, 191, 191]], ['G', [0, 191, 0]], ['Yl', [191, 191, 0]]]) {
    const [tx, ty] = pos(...rgb);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.strokeRect(tx - 6, ty - 6, 12, 12);
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText(n, tx + 9, ty + 4);
  }
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < px.length; i += 4) {
    const [tx, ty] = pos(px[i], px[i + 1], px[i + 2]);
    g.fillStyle = `rgba(${Math.min(255, px[i] + 60)},${Math.min(255, px[i + 1] + 60)},${Math.min(255, px[i + 2] + 60)},.18)`;
    g.fillRect(tx, ty, 2, 2);
  }
  g.restore();
  scopeLabel(g, 'Wektorskop', x, y);
}
