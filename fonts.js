'use strict';
/* fonts.js — wszystkie czcionki Google Fonts: wczytywanie na żądanie i wyszukiwarka */

const SYSTEM_FONTS = ['Arial', 'Georgia', 'Impact', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Tahoma'];
const FONT_INFO = new Map(GOOGLE_FONTS.map(([n, c, w, pl]) => [n, { cat: c, weights: w ? w.split(',').map(Number) : [400], pl: !!pl }]));
for (const n of SYSTEM_FONTS) FONT_INFO.set(n, { cat: 'sys', weights: [400, 700], pl: true, system: true });
const FONT_CATS = [['all', 'Wszystkie'], ['s', 'Bezszeryfowe'], ['r', 'Szeryfowe'], ['d', 'Ozdobne'], ['h', 'Odręczne'], ['m', 'Stałej szerokości'], ['sys', 'Systemowe']];
const WEIGHT_NAMES = { 100: 'Cienka', 200: 'Bardzo lekka', 300: 'Lekka', 400: 'Zwykła', 500: 'Średnia', 600: 'Półgruba', 700: 'Gruba', 800: 'Bardzo gruba', 900: 'Czarna' };

const fontLinks = new Map(); // nazwa -> Promise wczytania pełnej czcionki
const previewLinks = new Set();
const gfName = n => encodeURIComponent(n).replace(/%20/g, '+');

function fontWeights(name) { return FONT_INFO.get(name)?.weights || [400, 700]; }
function nearestWeight(name, w) {
  const ws = fontWeights(name);
  return ws.reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) ? x : b), ws[0]);
}

/* Pełna czcionka (wszystkie grubości) — do podglądu i eksportu */
function ensureFont(name) {
  const info = FONT_INFO.get(name);
  if (!info || info.system) return Promise.resolve();
  if (fontLinks.has(name)) return fontLinks.get(name);
  const p = new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${gfName(name)}:wght@${info.weights.join(';')}&display=swap`;
    link.onload = async () => {
      await Promise.all(info.weights.map(w => document.fonts.load(`${w} 48px "${name}"`, 'AaĄąŻż').catch(() => {})));
      resolve();
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  fontLinks.set(name, p);
  return p;
}
async function ensureProjectFonts() {
  const names = new Set(state.clips.filter(c => c.kind === 'text').map(c => c.props.font));
  if (!names.size) return;
  await Promise.all([...names].map(ensureFont));
  drawFrame();
}

/* Podgląd nazwy czcionki: tylko znaki z nazwy, więc pobiera się kilka kilobajtów */
function ensurePreview(name) {
  const info = FONT_INFO.get(name);
  if (!info || info.system || previewLinks.has(name) || fontLinks.has(name)) return;
  previewLinks.add(name);
  const w = info.weights.includes(400) ? 400 : info.weights[0];
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${gfName(name)}:wght@${w}&text=${encodeURIComponent(name + ' AaĄą')}&display=swap`;
  document.head.appendChild(link);
}

/* ---------------- Wybierak czcionek ---------------- */
let recentFonts = [];
try { recentFonts = JSON.parse(localStorage.getItem('cloudcut-recent-fonts') || '[]'); } catch { recentFonts = []; }
const fp = { el: null, onPick: null, cat: 'all', pl: true, q: '', items: [], shown: 0, active: 0, io: null, current: '' };

function openFontPicker(anchor, current, onPick) {
  closeFontPicker();
  fp.onPick = onPick;
  fp.current = current;
  fp.q = '';
  fp.active = 0;
  const el = document.createElement('div');
  el.className = 'font-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Wybór czcionki');
  el.innerHTML = `
    <div class="fp-head">
      <input type="search" class="fp-search" placeholder="Szukaj wśród ${GOOGLE_FONTS.length} czcionek…" aria-label="Szukaj czcionki" aria-controls="fpList" autocomplete="off">
      <div class="fp-cats">${FONT_CATS.map(([k, l]) => `<button type="button" class="chip${fp.cat === k ? ' on' : ''}" data-cat="${k}" aria-pressed="${fp.cat === k}">${l}</button>`).join('')}</div>
      <label class="check fp-pl"><input type="checkbox" class="fp-plbox"${fp.pl ? ' checked' : ''}> Tylko z polskimi znakami (ą, ę, ł…)</label>
    </div>
    <div class="fp-count" aria-live="polite"></div>
    <div class="fp-list" id="fpList" role="listbox" aria-label="Czcionki"></div>`;
  document.body.appendChild(el);
  fp.el = el;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(360, innerWidth - 16);
  el.style.width = w + 'px';
  el.style.left = clamp(r.right - w, 8, innerWidth - w - 8) + 'px';
  const top = r.bottom + 6, h = Math.min(480, innerHeight - 16);
  el.style.top = (top + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : top) + 'px';
  el.style.maxHeight = h + 'px';
  fp.io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) ensurePreview(en.target.dataset.font);
  }, { root: el.querySelector('.fp-list'), rootMargin: '200px' });
  filterFonts();
  const search = el.querySelector('.fp-search');
  search.addEventListener('input', () => { fp.q = search.value.trim().toLowerCase(); fp.active = 0; filterFonts(); });
  search.addEventListener('keydown', fpKey);
  el.querySelector('.fp-plbox').addEventListener('change', e => { fp.pl = e.target.checked; filterFonts(); });
  el.addEventListener('click', e => {
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      fp.cat = cat.dataset.cat;
      for (const b of el.querySelectorAll('[data-cat]')) { b.classList.toggle('on', b === cat); b.setAttribute('aria-pressed', b === cat); }
      fp.active = 0; filterFonts(); search.focus();
      return;
    }
    const it = e.target.closest('[data-font]');
    if (it) pickFont(it.dataset.font);
  });
  el.querySelector('.fp-list').addEventListener('scroll', e => {
    const l = e.target;
    if (l.scrollTop + l.clientHeight > l.scrollHeight - 300) renderFontItems(120);
  });
  setTimeout(() => { search.focus(); document.addEventListener('pointerdown', fpOutside, true); }, 0);
}
function fpOutside(e) { if (fp.el && !fp.el.contains(e.target)) closeFontPicker(); }
function closeFontPicker() {
  if (!fp.el) return;
  fp.io?.disconnect();
  fp.el.remove();
  fp.el = null;
  document.removeEventListener('pointerdown', fpOutside, true);
}
function filterFonts() {
  const all = [...FONT_INFO.entries()];
  const q = fp.q;
  let items = all.filter(([n, i]) => (fp.cat === 'all' || i.cat === fp.cat) && (!fp.pl || i.pl) && (!q || n.toLowerCase().includes(q)));
  if (q) items.sort((a, b) => (a[0].toLowerCase().startsWith(q) ? 0 : 1) - (b[0].toLowerCase().startsWith(q) ? 0 : 1));
  const rec = !q && fp.cat === 'all' ? recentFonts.filter(n => FONT_INFO.has(n)) : [];
  fp.items = [...rec.map(n => [n, FONT_INFO.get(n), true]), ...items.filter(([n]) => !rec.includes(n))];
  fp.shown = 0;
  fp.el.querySelector('.fp-list').innerHTML = '';
  fp.el.querySelector('.fp-count').textContent = `${items.length} ${items.length === 1 ? 'czcionka' : 'czcionek'}`;
  renderFontItems(80);
  highlightFont();
}
function renderFontItems(n) {
  const list = fp.el.querySelector('.fp-list');
  const slice = fp.items.slice(fp.shown, fp.shown + n);
  const catName = Object.fromEntries(FONT_CATS);
  const html = slice.map(([name, info, recent], i) => {
    const idx = fp.shown + i;
    const sep = recent && idx === 0 ? '<div class="fp-sep">Ostatnio używane</div>' : (!recent && fp.items[idx - 1]?.[2]) ? '<div class="fp-sep">Wszystkie</div>' : '';
    return `${sep}<button type="button" class="fp-item${name === fp.current ? ' cur' : ''}" role="option" id="fpo-${idx}" data-i="${idx}" data-font="${esc(name)}" aria-selected="${name === fp.current}">
      <span class="fp-name" style="font-family:'${esc(name)}',sans-serif">${esc(name)}</span><span class="fp-meta">${catName[info.cat] || ''} · ${info.weights.length} ${info.weights.length === 1 ? 'grubość' : 'grubości'}</span></button>`;
  }).join('');
  list.insertAdjacentHTML('beforeend', html);
  for (const b of list.querySelectorAll('.fp-item:not([data-obs])')) { b.dataset.obs = '1'; fp.io.observe(b); }
  fp.shown += slice.length;
}
function highlightFont() {
  if (!fp.el) return;
  for (const b of fp.el.querySelectorAll('.fp-item.act')) b.classList.remove('act');
  while (fp.active >= fp.shown && fp.shown < fp.items.length) renderFontItems(80);
  const b = fp.el.querySelector(`#fpo-${fp.active}`);
  if (b) { b.classList.add('act'); b.scrollIntoView({ block: 'nearest' }); fp.el.querySelector('.fp-search').setAttribute('aria-activedescendant', b.id); }
}
function fpKey(e) {
  if (e.key === 'ArrowDown') { fp.active = Math.min(fp.items.length - 1, fp.active + 1); highlightFont(); }
  else if (e.key === 'ArrowUp') { fp.active = Math.max(0, fp.active - 1); highlightFont(); }
  else if (e.key === 'PageDown') { fp.active = Math.min(fp.items.length - 1, fp.active + 10); highlightFont(); }
  else if (e.key === 'PageUp') { fp.active = Math.max(0, fp.active - 10); highlightFont(); }
  else if (e.key === 'Enter') { const it = fp.items[fp.active]; if (it) pickFont(it[0]); }
  else if (e.key === 'Escape') { closeFontPicker(); }
  else return;
  e.preventDefault();
  e.stopPropagation();
}
function pickFont(name) {
  recentFonts = [name, ...recentFonts.filter(n => n !== name)].slice(0, 8);
  try { localStorage.setItem('cloudcut-recent-fonts', JSON.stringify(recentFonts)); } catch { /* bez zapisu */ }
  const cb = fp.onPick;
  closeFontPicker();
  ensureFont(name).then(() => drawFrame());
  cb?.(name);
}
