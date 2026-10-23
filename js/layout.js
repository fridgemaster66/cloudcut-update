'use strict';
/* layout.js — szablony układu okna, wielkość sekcji i ustawienia interfejsu */

/* Każdy szablon to siatka CSS: obszary top/bin/viewer/insp/tl.
   handles: które krawędzie paneli da się przeciągać i którą zmienną zmieniają.
   hide: czym zastąpić obszar ukrytego panelu (sąsiad, który go wchłania). */
const LAYOUTS = [
  {
    id: 'standard', name: 'Standardowy', desc: 'Media z lewej, właściwości z prawej, oś czasu na dole',
    areas: ['top top top', 'bin viewer insp', 'tl tl tl'], cols: 'var(--bin-w) minmax(0,1fr) var(--insp-w)', rows: '46px minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'right', 'binW'], ['insp', 'left', 'inspW'], ['tl', 'top', 'tlH']], hide: { bin: 'viewer', insp: 'viewer' },
  },
  {
    id: 'mirror', name: 'Odwrócony', desc: 'Właściwości z lewej, media z prawej',
    areas: ['top top top', 'insp viewer bin', 'tl tl tl'], cols: 'var(--insp-w) minmax(0,1fr) var(--bin-w)', rows: '46px minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'left', 'binW'], ['insp', 'right', 'inspW'], ['tl', 'top', 'tlH']], hide: { bin: 'viewer', insp: 'viewer' },
  },
  {
    id: 'tallInsp', name: 'Wysokie właściwości', desc: 'Panel właściwości na całą wysokość okna',
    areas: ['top top top', 'bin viewer insp', 'tl tl insp'], cols: 'var(--bin-w) minmax(0,1fr) var(--insp-w)', rows: '46px minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'right', 'binW'], ['insp', 'left', 'inspW'], ['tl', 'top', 'tlH']], hide: { bin: 'viewer', insp: 'tl' },
  },
  {
    id: 'editing', name: 'Montaż', desc: 'Wysoka oś czasu — wygodne cięcie długich nagrań',
    areas: ['top top top', 'bin viewer insp', 'tl tl tl'], cols: 'var(--bin-w) minmax(0,1fr) var(--insp-w)', rows: '46px minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'right', 'binW'], ['insp', 'left', 'inspW'], ['tl', 'top', 'tlH']], hide: { bin: 'viewer', insp: 'viewer' },
    preset: { tlH: 0.55, binW: 240, inspW: 290 },
  },
  {
    id: 'bigPreview', name: 'Duży podgląd', desc: 'Podgląd na całą szerokość, media i właściwości w kolumnie z prawej',
    areas: ['top top', 'viewer bin', 'viewer insp', 'tl tl'], cols: 'minmax(0,1fr) var(--side-w)', rows: '46px var(--bin-h) minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'left', 'sideW'], ['insp', 'left', 'sideW'], ['insp', 'top', 'binH'], ['tl', 'top', 'tlH']], hide: { bin: 'insp', insp: 'bin' },
  },
  {
    id: 'leftStack', name: 'Panele z lewej', desc: 'Media i właściwości jeden pod drugim po lewej stronie',
    areas: ['top top', 'bin viewer', 'insp viewer', 'tl tl'], cols: 'var(--side-w) minmax(0,1fr)', rows: '46px var(--bin-h) minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'right', 'sideW'], ['insp', 'right', 'sideW'], ['insp', 'top', 'binH'], ['tl', 'top', 'tlH']], hide: { bin: 'insp', insp: 'bin' },
  },
  {
    id: 'vertical', name: 'Pionowe filmy', desc: 'Pod rolki i TikToka — wąski podgląd, oś czasu między panelami',
    areas: ['top top top', 'bin viewer insp', 'bin tl insp'], cols: 'var(--bin-w) minmax(0,1fr) var(--insp-w)', rows: '46px minmax(0,1fr) var(--tl-h)',
    handles: [['bin', 'right', 'binW'], ['insp', 'left', 'inspW'], ['tl', 'top', 'tlH']], hide: { bin: 'viewer', insp: 'viewer' },
    preset: { binW: 300, inspW: 330, tlH: 0.4 },
  },
];

const SIZE_DEF = {
  binW: { label: 'Szerokość mediów', min: 180, max: 640, unit: 'px', def: 280 },
  inspW: { label: 'Szerokość właściwości', min: 240, max: 640, unit: 'px', def: 310 },
  sideW: { label: 'Szerokość kolumny paneli', min: 220, max: 700, unit: 'px', def: 340 },
  binH: { label: 'Wysokość mediów w kolumnie', min: 140, max: 700, unit: 'px', def: 300 },
  tlH: { label: 'Wysokość osi czasu', min: 0.18, max: 0.75, unit: 'vh', def: 0.4 },
  trackH: { label: 'Wysokość ścieżek', min: 34, max: 120, unit: 'px', def: 58 },
};
const UI_DEFAULTS = { layout: 'standard', showBin: true, showInsp: true, showMeter: true, previewQ: 1, avatar: 'niebieski', sizes: Object.fromEntries(Object.entries(SIZE_DEF).map(([k, v]) => [k, v.def])) };
// kolory avatara (kółko z pierwszą literą e-maila); jasne tła mają ciemną literę, żeby była czytelna
const AVATARS = [
  { id: 'niebieski', name: 'Niebiesko-fioletowy', bg: 'linear-gradient(135deg, #6b95ff, #b06bff)', fg: '#fff' },
  { id: 'teczowy', name: 'Tęcza CloudCut', bg: 'linear-gradient(135deg, #6b95ff, #b06bff 35%, #ff6b8b 68%, #ffb35c)', fg: '#fff' },
  { id: 'zachod', name: 'Zachód słońca', bg: 'linear-gradient(135deg, #ff8a5c, #e8366d)', fg: '#fff' },
  { id: 'malinowy', name: 'Malinowy', bg: 'linear-gradient(135deg, #f78fb3, #c2255c)', fg: '#fff' },
  { id: 'morski', name: 'Morski', bg: 'linear-gradient(135deg, #12c2b5, #2563eb)', fg: '#fff' },
  { id: 'las', name: 'Leśny', bg: 'linear-gradient(135deg, #5fd38d, #15803d)', fg: '#fff' },
  { id: 'zloty', name: 'Złoty', bg: 'linear-gradient(135deg, #ffe08a, #f59f00)', fg: '#2b1a00' },
  { id: 'grafit', name: 'Grafit', bg: 'linear-gradient(135deg, #9aa5b4, #3f4756)', fg: '#fff' },
];
function applyAvatar() {
  const a = AVATARS.find(x => x.id === ui.avatar) || AVATARS[0];
  document.documentElement.style.setProperty('--avatar-bg', a.bg);
  document.documentElement.style.setProperty('--avatar-fg', a.fg);
}
let ui = structuredClone(UI_DEFAULTS);
try {
  const saved = JSON.parse(localStorage.getItem('cloudcut-ui') || 'null');
  if (saved) ui = { ...ui, ...saved, sizes: { ...ui.sizes, ...saved.sizes } };
} catch { /* domyślne */ }

const layoutOf = id => LAYOUTS.find(l => l.id === id) || LAYOUTS[0];
let uiSaveTimer = null;
function saveUi() {
  try { localStorage.setItem('cloudcut-ui', JSON.stringify(ui)); } catch { /* bez zapisu */ }
  clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => Store.saveSettings?.({ ui, keys: customKeys }), 800);
}

function sizeCss(k) {
  const v = ui.sizes[k];
  return SIZE_DEF[k].unit === 'vh' ? `${Math.round(v * 1000) / 10}vh` : `${Math.round(v)}px`;
}

function applyLayout() {
  applyAvatar();
  const narrow = innerWidth < 700, medium = innerWidth < 1000;
  let L = layoutOf(ui.layout);
  const body = document.body;
  let areas = [...L.areas];
  const showBin = ui.showBin && !narrow;
  const showInsp = ui.showInsp && !medium;
  const replace = (name, by) => { areas = areas.map(r => r.split(' ').map(a => (a === name ? by : a)).join(' ')); };
  if (narrow) {
    // telefon / wąskie okno: wszystko jedno pod drugim
    areas = ['top', 'viewer', 'tl'];
    body.style.gridTemplateColumns = 'minmax(0,1fr)';
    body.style.gridTemplateRows = '46px minmax(0,1fr) 46vh';
  } else {
    if (!showInsp) replace('insp', L.hide.insp);
    if (!showBin) replace('bin', L.hide.bin === 'insp' && !showInsp ? 'viewer' : L.hide.bin);
    if (!showInsp && !showBin) replace('insp', 'viewer');
    body.style.gridTemplateColumns = L.cols;
    body.style.gridTemplateRows = L.rows;
  }
  body.style.gridTemplateAreas = areas.map(r => `"${r}"`).join(' ');
  for (const k of Object.keys(SIZE_DEF)) body.style.setProperty('--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), sizeCss(k));
  document.documentElement.style.setProperty('--track-h', ui.sizes.trackH + 'px');
  $('.bin').hidden = !showBin;
  $('.inspector').hidden = !showInsp;
  $('#meterCv').hidden = !ui.showMeter;
  placeHandles(narrow ? null : L, { bin: showBin, insp: showInsp });
  requestAnimationFrame(() => { layoutStage(); renderLanes(); drawMeter(true); });
}

/* ---------------- Przeciąganie krawędzi ---------------- */
const PANEL_SEL = { bin: '.bin', insp: '.inspector', tl: '.timeline' };
function placeHandles(L, visible) {
  $$('.rz').forEach(h => h.remove());
  if (!L) return;
  for (const [panel, side, key] of L.handles) {
    if (visible[panel] === false) continue;
    const host = $(PANEL_SEL[panel]);
    const h = document.createElement('div');
    h.className = `rz rz-${side}`;
    h.dataset.key = key;
    h.dataset.side = side;
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-orientation', side === 'top' || side === 'bottom' ? 'horizontal' : 'vertical');
    h.setAttribute('aria-label', 'Zmień: ' + SIZE_DEF[key].label.toLowerCase());
    h.tabIndex = 0;
    h.title = SIZE_DEF[key].label + ' — przeciągnij (dwuklik przywraca)';
    host.appendChild(h);
  }
}
function setSize(key, v) {
  const d = SIZE_DEF[key];
  ui.sizes[key] = clamp(v, d.min, d.max);
  applyLayout();
  saveUi();
  syncSizeCtrls();
}
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('.rz');
  if (!h || e.button !== 0) return;
  e.preventDefault();
  const key = h.dataset.key, side = h.dataset.side, d = SIZE_DEF[key];
  const x0 = e.clientX, y0 = e.clientY, v0 = ui.sizes[key];
  document.body.classList.add('resizing', side === 'top' || side === 'bottom' ? 'rz-v' : 'rz-h');
  const mv = ev => {
    let delta = side === 'right' ? ev.clientX - x0 : side === 'left' ? x0 - ev.clientX : side === 'top' ? y0 - ev.clientY : ev.clientY - y0;
    if (d.unit === 'vh') delta /= innerHeight;
    ui.sizes[key] = clamp(v0 + delta, d.min, d.max);
    applyLayout();
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing', 'rz-v', 'rz-h');
    saveUi(); syncSizeCtrls();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => {
  const h = e.target.closest('.rz');
  if (h) setSize(h.dataset.key, SIZE_DEF[h.dataset.key].def);
});
document.addEventListener('keydown', e => {
  const h = e.target.closest?.('.rz');
  if (!h) return;
  const key = h.dataset.key, d = SIZE_DEF[key], side = h.dataset.side;
  const step = (d.unit === 'vh' ? 0.02 : 16) * (e.shiftKey ? 3 : 1);
  const grow = { right: 'ArrowRight', left: 'ArrowLeft', top: 'ArrowUp', bottom: 'ArrowDown' }[side];
  const shrink = { right: 'ArrowLeft', left: 'ArrowRight', top: 'ArrowDown', bottom: 'ArrowUp' }[side];
  if (e.key === grow) setSize(key, ui.sizes[key] + step);
  else if (e.key === shrink) setSize(key, ui.sizes[key] - step);
  else return;
  e.preventDefault();
  e.stopPropagation();
  h.focus?.();
}, true);

/* ---------------- Okno ustawień ---------------- */
const setDlg = $('#settingsDlg');
function miniLayout(L) {
  const names = { bin: 'Media', viewer: 'Podgląd', insp: 'Właściw.', tl: 'Oś czasu' };
  const cells = [...new Set(L.areas.join(' ').split(' '))].filter(a => a !== 'top');
  const rows = L.areas.slice(1).map(r => `'${r}'`).join(' ');
  return `<div class="mini" style="grid-template-areas:${rows}">${cells.map(a => `<span class="mini-${a}" style="grid-area:${a}">${names[a]}</span>`).join('')}</div>`;
}
function renderSettings() {
  $('#layoutGrid').innerHTML = LAYOUTS.map(L => `<button type="button" class="layout-card${ui.layout === L.id ? ' on' : ''}" role="radio" aria-checked="${ui.layout === L.id}" data-layout="${L.id}">
    ${miniLayout(L)}<span class="lc-name">${L.name}</span><span class="lc-desc">${L.desc}</span></button>`).join('');
  const L = layoutOf(ui.layout);
  const keys = [...new Set([...L.handles.map(h => h[2]), 'trackH'])];
  $('#sizeCtrls').innerHTML = keys.map(k => {
    const d = SIZE_DEF[k];
    const st = d.unit === 'vh' ? 0.01 : 1;
    return `<div class="field"><div class="lbl"><label for="sz-${k}">${d.label}</label><output id="szo-${k}">${fmtSize(k)}</output></div>
      <input type="range" id="sz-${k}" data-size="${k}" min="${d.min}" max="${d.max}" step="${st}" value="${ui.sizes[k]}"></div>`;
  }).join('');
  $('#setShowBin').checked = ui.showBin;
  $('#setShowInsp').checked = ui.showInsp;
  $('#setShowMeter').checked = ui.showMeter;
  $('#setPreviewQ').value = String(ui.previewQ);
  $('#setSyncNote').textContent = Store.mode === 'cloud' ? 'Ustawienia i skróty zapisują się na Twoim koncie — zobaczysz je po zalogowaniu na innym komputerze.' : 'Ustawienia zapisują się w tej przeglądarce.';
  const initial = Store.mode === 'cloud' ? Store.user.email[0].toUpperCase() : '?';
  $('#avatarGrid').innerHTML = AVATARS.map(a => `<button type="button" class="av-pick${ui.avatar === a.id ? ' on' : ''}" role="radio" aria-checked="${ui.avatar === a.id}" data-avatar="${a.id}" title="${a.name}">
    <span class="avatar" style="background:${a.bg};color:${a.fg}" aria-hidden="true">${esc(initial)}</span><span class="av-name">${a.name}</span></button>`).join('');
}
const fmtSize = k => (SIZE_DEF[k].unit === 'vh' ? Math.round(ui.sizes[k] * 100) + '% okna' : Math.round(ui.sizes[k]) + ' px');
function syncSizeCtrls() {
  if (!setDlg.open) return;
  for (const el of $$('[data-size]', setDlg)) { el.value = ui.sizes[el.dataset.size]; paintRange(el); $('#szo-' + el.dataset.size).textContent = fmtSize(el.dataset.size); }
}
function openSettings() {
  // treść mogła zostać w zakładce „Ustawienia” menu głównego — wraca do okna
  setDlg.insertBefore($('#setBody'), setDlg.querySelector('.dlg-actions'));
  renderSettings();
  setDlg.showModal();
}

$('#layoutGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-layout]');
  if (!b) return;
  ui.layout = b.dataset.layout;
  const L = layoutOf(ui.layout);
  if (L.preset) Object.assign(ui.sizes, L.preset);
  applyLayout(); saveUi(); renderSettings();
  $(`[data-layout="${ui.layout}"]`)?.focus();
});
$('#layoutGrid').addEventListener('keydown', e => {
  const cards = $$('.layout-card', $('#layoutGrid'));
  const i = cards.indexOf(document.activeElement);
  if (i < 0) return;
  const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (n) { e.preventDefault(); cards[(i + n + cards.length) % cards.length].click(); }
});
$('#sizeCtrls').addEventListener('input', e => {
  const k = e.target.dataset.size;
  if (!k) return;
  ui.sizes[k] = +e.target.value;
  $('#szo-' + k).textContent = fmtSize(k);
  applyLayout();
});
$('#sizeCtrls').addEventListener('change', saveUi);
$('#setShowBin').addEventListener('change', e => { ui.showBin = e.target.checked; applyLayout(); saveUi(); });
$('#setShowInsp').addEventListener('change', e => { ui.showInsp = e.target.checked; applyLayout(); saveUi(); });
$('#setShowMeter').addEventListener('change', e => { ui.showMeter = e.target.checked; applyLayout(); saveUi(); });
$('#setPreviewQ').addEventListener('change', e => {
  ui.previewQ = +e.target.value; saveUi();
  $('#previewQ').value = e.target.value;
  if (!exporting) setRenderScale(ui.previewQ);
});
$('#avatarGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-avatar]');
  if (!b) return;
  ui.avatar = b.dataset.avatar;
  applyAvatar(); saveUi(); renderSettings();
  $(`[data-avatar="${ui.avatar}"]`)?.focus();
});
$('#avatarGrid').addEventListener('keydown', e => {
  const picks = $$('.av-pick', $('#avatarGrid'));
  const i = picks.indexOf(document.activeElement);
  const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (i >= 0 && n) { e.preventDefault(); picks[(i + n + picks.length) % picks.length].click(); }
});

/* Podgląd układu: na chwilę chowa Ustawienia (okno albo menu główne), żeby zobaczyć edytor z nowymi wymiarami */
let layoutPeekFrom = null;
function previewLayout() {
  layoutPeekFrom = isHomeOpen() ? 'home' : 'dialog';
  if (layoutPeekFrom === 'home') { homeEl.hidden = true; document.body.classList.remove('home-open'); }
  else setDlg.close();
  // całe przerysowanie: bez otwartego projektu nazwy ścieżek nie były jeszcze narysowane
  applyLayout(); layoutStage(); renderAll();
  $('#layoutPeek').hidden = false;
  $('#layoutPeekBack').focus();
}
function endLayoutPreview() {
  if (!layoutPeekFrom) return;
  const from = layoutPeekFrom;
  layoutPeekFrom = null;
  $('#layoutPeek').hidden = true;
  if (from === 'home') { homeEl.hidden = false; document.body.classList.add('home-open'); renderSettings(); }
  else openSettings();
}
$('#setPreviewLayout').addEventListener('click', previewLayout);
$('#layoutPeekBack').addEventListener('click', endLayoutPreview);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && layoutPeekFrom && !document.querySelector('dialog[open]')) { e.preventDefault(); e.stopImmediatePropagation(); endLayoutPreview(); }
}, true);
$('#setReset').addEventListener('click', () => { ui = { ...structuredClone(UI_DEFAULTS), avatar: ui.avatar }; applyLayout(); saveUi(); renderSettings(); });
$('#setClose').addEventListener('click', () => setDlg.close());
$('#btnSettings').addEventListener('click', openSettings);
window.addEventListener('resize', () => applyLayout());

function applyUiSettings(obj) {
  if (!obj) return;
  ui = { ...structuredClone(UI_DEFAULTS), ...obj, sizes: { ...UI_DEFAULTS.sizes, ...(obj.sizes || {}) } };
  try { localStorage.setItem('cloudcut-ui', JSON.stringify(ui)); } catch { /* bez zapisu */ }
  applyLayout();
}
