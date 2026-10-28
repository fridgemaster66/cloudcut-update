'use strict';
/* ui.js — biblioteka, inspektor, monitor źródła, eksport, projekty, skróty i start aplikacji */

/* =========================================================
   Menu kontekstowe
   ========================================================= */
const menuEl = $('#ctxMenu');
let menuReturnFocus = null;
function openMenu(x, y, items) {
  menuReturnFocus = document.activeElement;
  menuEl.innerHTML = items.map((it, i) => it === '-' ? '<hr>' :
    `<button role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}><span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`).join('');
  menuEl.hidden = false;
  menuEl._items = items;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menuEl.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menuEl.querySelector('button:not(:disabled)')?.focus();
}
function closeMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuReturnFocus?.focus?.();
}
menuEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const it = menuEl._items[+b.dataset.i];
  closeMenu();
  it.act?.();
});
document.addEventListener('pointerdown', e => { if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu(); });
function menuKey(e) {
  const btns = $$('button:not(:disabled)', menuEl);
  const i = btns.indexOf(document.activeElement);
  if (e.key === 'Escape') { closeMenu(); }
  else if (e.key === 'ArrowDown') btns[(i + 1) % btns.length]?.focus();
  else if (e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length]?.focus();
  else if (e.key === 'Tab') closeMenu();
  else return false;
  e.preventDefault();
  return true;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 120000);
}
const safeName = s => (s.trim() || 'film').replace(/[\\/:*?"<>|]+/g, '_');

/* =========================================================
   Biblioteka mediów z folderami
   ========================================================= */
let binFolder = null;          // otwarty folder (null = główny)
const binSel = new Set();      // zaznaczone pliki w bibliotece
let binListView = false;
try { binListView = localStorage.getItem('cloudcut-bin-view') === 'list'; } catch { /* brak */ }
const FOLDER_COLORS = ['#6b95ff', '#5fd39b', '#ffd34d', '#ff9f43', '#ff6b8b', '#c38bff', '#a1a8b5'];
const folderOf = mid => state.mediaFolder?.[mid] || null;
const folderById = id => state.folders.find(f => f.id === id);
function folderPath(id) {
  const out = [];
  for (let f = folderById(id), guard = 0; f && guard < 50; f = folderById(f.parent), guard++) out.unshift(f);
  return out;
}
function folderCount(id) {
  const kids = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of state.folders) if (kids.has(f.parent) && !kids.has(f.id)) { kids.add(f.id); grew = true; } }
  return [...media.keys()].filter(mid => kids.has(folderOf(mid))).length;
}

function renderBin() {
  const list = $('#binList');
  list.classList.toggle('list-view', binListView);
  $('#binView').setAttribute('aria-pressed', binListView);
  if (binFolder && !folderById(binFolder)) binFolder = null;
  const q = $('#binSearch').value.trim().toLowerCase();
  const filter = $('#binFilter').value, sort = $('#binSort').value;
  // okruszki
  const path = folderPath(binFolder);
  $('#binCrumbs').innerHTML = `<button type="button" class="crumb" data-crumb="" title="Upuść tutaj, aby przenieść do głównego folderu">Wszystkie media</button>` +
    path.map(f => `<span aria-hidden="true">›</span><button type="button" class="crumb" data-crumb="${f.id}">${esc(f.name)}</button>`).join('');
  if (!media.size && !state.folders.length) {
    list.innerHTML = `<div class="bin-empty"><strong>Brak plików</strong>Przeciągnij tutaj filmy, muzykę, zdjęcia lub napisy SRT albo kliknij „Importuj”.</div>`;
    return;
  }
  const usage = new Map();
  for (const c of state.clips) if (c.mediaId) usage.set(c.mediaId, (usage.get(c.mediaId) || 0) + 1);
  let items = [...media.values()];
  if (q) items = items.filter(m => m.name.toLowerCase().includes(q));
  else items = items.filter(m => folderOf(m.id) === binFolder);
  if (filter === 'unused') items = items.filter(m => !usage.get(m.id));
  else if (filter !== 'all') items = items.filter(m => m.kind === filter);
  const order = [...media.keys()];
  if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  else if (sort === 'dur') items.sort((a, b) => (b.duration === Infinity ? 0 : b.duration) - (a.duration === Infinity ? 0 : a.duration));
  else if (sort === 'kind') items.sort((a, b) => a.kind.localeCompare(b.kind));
  else items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const folders = q ? [] : state.folders.filter(f => (f.parent || null) === binFolder).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const fHtml = folders.map(f => `<div class="m-card f-card" data-folder="${f.id}" tabindex="0" role="button" aria-label="Folder ${esc(f.name)} — Enter otwiera">
      <div class="m-thumb f-thumb" style="--fc:${f.color || FOLDER_COLORS[0]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
      <div class="m-meta"><div class="m-name">${esc(f.name)}</div><div class="m-sub"><span>${plural(folderCount(f.id), 'plik', 'pliki', 'plików')}</span></div></div></div>`).join('');
  const mHtml = items.map(m => {
    let thumb = '', inner = ICON[m.kind], cls = 'm-thumb';
    if (m.kind === 'audio' && m.wave) { thumb = `style="background-image:url('${m.wave}')"`; inner = ''; cls += ' wave'; }
    else if (m.thumb) { thumb = `style="background-image:url('${m.thumb}')"`; inner = ''; }
    const label = { video: 'Wideo', audio: 'Audio', image: 'Obraz' }[m.kind];
    const dur = m.kind === 'image' ? `${m.w}×${m.h}` : shortDur(m.duration);
    const used = usage.get(m.id);
    const where = q && folderOf(m.id) ? ` · ${esc(folderById(folderOf(m.id))?.name || '')}` : '';
    return `<div class="m-card${m.loading ? ' m-loading' : ''}${srcMediaId === m.id ? ' src-active' : ''}${binSel.has(m.id) ? ' bin-sel' : ''}" draggable="${!m.loading}" data-media="${m.id}" tabindex="0"
        role="button" aria-pressed="${binSel.has(m.id)}" aria-label="${esc(m.name)}. Enter: dodaj w miejscu głowicy. Dwuklik: monitor źródła.">
      <div class="${cls}" ${thumb}>${m.loading ? '' : inner}</div>
      <span class="m-badge">${label}</span>
      <button class="m-del" data-del="${m.id}" aria-label="Usuń ${esc(m.name)} z projektu" title="Usuń z projektu">${ICON.x}</button>
      <div class="m-meta"><div class="m-name" title="${esc(m.name)}">${esc(m.name)}</div>
      <div class="m-sub"><span>${m.loading ? 'Analiza…' : m.upload != null ? 'Wysyłanie ' + Math.round(m.upload * 100) + '%' : dur}${where}</span>${used ? `<span class="m-used" title="Użyty na osi czasu">● ${used}</span>` : ''}</div></div>
    </div>`;
  }).join('');
  list.innerHTML = fHtml + mHtml || `<div class="bin-empty">${q ? `Nic nie pasuje do „${esc(q)}”.` : 'Ten folder jest pusty — przeciągnij tu pliki z biblioteki albo z komputera.'}</div>`;
}
for (const id of ['#binSearch', '#binFilter', '#binSort']) $(id).addEventListener(id === '#binSearch' ? 'input' : 'change', renderBin);
$('#binView').addEventListener('click', () => {
  binListView = !binListView;
  try { localStorage.setItem('cloudcut-bin-view', binListView ? 'list' : 'grid'); } catch { /* brak */ }
  renderBin();
});

async function createFolder(parent = binFolder) {
  const name = await ask('Nazwa nowego folderu', 'Nowy folder', { ok: 'Utwórz' });
  if (!name?.trim()) return null;
  const f = { id: uid('f'), name: name.trim().slice(0, 60), parent: parent || null, color: FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length] };
  state.folders.push(f);
  for (const mid of binSel) state.mediaFolder[mid] = f.id; // zaznaczone pliki od razu do nowego folderu
  binSel.clear();
  commit(); renderBin();
  return f;
}
function moveToFolder(mids, folderId) {
  for (const mid of mids) {
    if (folderId) state.mediaFolder[mid] = folderId; else delete state.mediaFolder[mid];
  }
  binSel.clear();
  commit(); renderBin();
  toast(`Przeniesiono ${plural(mids.length, 'plik', 'pliki', 'plików')} do „${folderId ? folderById(folderId).name : 'Wszystkie media'}”`, 1800);
}
function deleteFolder(id) {
  const f = folderById(id);
  if (!f) return;
  // zawartość przechodzi piętro wyżej — pliki nie znikają
  for (const [mid, fid] of Object.entries(state.mediaFolder)) if (fid === id) { if (f.parent) state.mediaFolder[mid] = f.parent; else delete state.mediaFolder[mid]; }
  for (const sub of state.folders) if (sub.parent === id) sub.parent = f.parent || null;
  state.folders = state.folders.filter(x => x.id !== id);
  if (binFolder === id) binFolder = f.parent || null;
  commit(); renderBin();
}
$('#binNewFolder').addEventListener('click', () => createFolder());

const binEl = $('#binList');
binEl.addEventListener('dragstart', e => {
  const card = e.target.closest('.m-card[data-media]');
  if (!card) return;
  const id = card.dataset.media;
  if (!binSel.has(id)) { binSel.clear(); binSel.add(id); }
  e.dataTransfer.setData('text/x-kadr-media', id);
  e.dataTransfer.setData('text/x-kadr-medialist', JSON.stringify([...binSel]));
  e.dataTransfer.effectAllowed = 'copyMove';
});
function folderDropTarget(e) { return e.target.closest('.f-card[data-folder], .crumb'); }
for (const el of [binEl, $('#binCrumbs')]) {
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/x-kadr-medialist')) return;
    const t = folderDropTarget(e);
    $$('.drop-into').forEach(x => x.classList.remove('drop-into'));
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    t.classList.add('drop-into');
  });
  el.addEventListener('drop', e => {
    const t = folderDropTarget(e);
    $$('.drop-into').forEach(x => x.classList.remove('drop-into'));
    if (!t || !e.dataTransfer.types.includes('text/x-kadr-medialist')) return;
    e.preventDefault();
    e.stopPropagation();
    const ids = JSON.parse(e.dataTransfer.getData('text/x-kadr-medialist') || '[]');
    moveToFolder(ids, t.dataset.folder ?? (t.dataset.crumb || null));
  });
}
$('#binCrumbs').addEventListener('click', e => {
  const b = e.target.closest('.crumb');
  if (b) { binFolder = b.dataset.crumb || null; binSel.clear(); renderBin(); }
});
binEl.addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); removeMedia(del.dataset.del); return; }
  const card = e.target.closest('.m-card[data-media]');
  if (card && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    const id = card.dataset.media;
    binSel.has(id) ? binSel.delete(id) : binSel.add(id);
    renderBin();
  } else if (card) { binSel.clear(); binSel.add(card.dataset.media); for (const c of $$('.m-card.bin-sel', binEl)) c.classList.remove('bin-sel'); card.classList.add('bin-sel'); }
  else if (!e.target.closest('.f-card')) { binSel.clear(); for (const c of $$('.m-card.bin-sel', binEl)) c.classList.remove('bin-sel'); }
});
binEl.addEventListener('dblclick', e => {
  const f = e.target.closest('.f-card');
  if (f) { binFolder = f.dataset.folder; binSel.clear(); renderBin(); return; }
  const card = e.target.closest('.m-card[data-media]');
  if (!card || e.target.closest('[data-del]')) return;
  const m = media.get(card.dataset.media);
  if (!m || m.loading) return;
  if (m.kind === 'image') placeMedia(m, { t: playhead });
  else openSource(m.id);
});
binEl.addEventListener('keydown', e => {
  const f = e.target.closest('.f-card');
  if (f && e.target === f && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); binFolder = f.dataset.folder; renderBin(); binEl.querySelector('.m-card')?.focus(); return; }
  const card = e.target.closest('.m-card[data-media]');
  if (card && e.target === card && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); placeMedia(media.get(card.dataset.media), { t: playhead }); }
  if (e.key === 'Backspace' && binFolder && !e.target.closest('input')) { e.preventDefault(); e.stopPropagation(); binFolder = folderById(binFolder)?.parent || null; renderBin(); }
});
binEl.addEventListener('contextmenu', e => {
  const fcard = e.target.closest('.f-card');
  if (fcard) {
    e.preventDefault();
    const f = folderById(fcard.dataset.folder);
    openMenu(e.clientX, e.clientY, [
      { label: 'Otwórz', act: () => { binFolder = f.id; renderBin(); } },
      { label: 'Zmień nazwę', act: async () => { const v = await ask('Nazwa folderu', f.name, { ok: 'Zapisz' }); if (v?.trim()) { f.name = v.trim().slice(0, 60); commit(); renderBin(); } } },
      { label: 'Nowy podfolder', act: () => createFolder(f.id) },
      { label: 'Zmień kolor', act: () => { f.color = FOLDER_COLORS[(FOLDER_COLORS.indexOf(f.color) + 1) % FOLDER_COLORS.length]; commit(); renderBin(); } },
      '-',
      { label: 'Usuń folder (pliki zostaną)', act: () => deleteFolder(f.id) },
    ]);
    return;
  }
  const card = e.target.closest('.m-card[data-media]');
  if (!card) {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: 'Nowy folder', act: () => createFolder() },
      { label: 'Importuj pliki tutaj', act: () => $('#fileInput').click() },
    ]);
    return;
  }
  e.preventDefault();
  const m = media.get(card.dataset.media);
  if (!m || m.loading) return;
  if (!binSel.has(m.id)) { binSel.clear(); binSel.add(m.id); renderBin(); }
  const ids = [...binSel];
  const folderItems = [{ label: '→ Wszystkie media', disabled: !ids.some(folderOf), act: () => moveToFolder(ids, null) },
    ...state.folders.map(f => ({ label: '→ ' + folderPath(f.id).map(x => x.name).join(' › '), disabled: ids.every(i => folderOf(i) === f.id), act: () => moveToFolder(ids, f.id) })),
    { label: '→ Nowy folder…', act: () => createFolder() }];
  openMenu(e.clientX, e.clientY, [
    { label: 'Dodaj w miejscu głowicy (nadpisz)', act: () => placeMedia(m, { t: playhead }) },
    { label: 'Wstaw w miejscu głowicy (rozsuń)', act: () => placeMedia(m, { t: playhead, mode: 'insert' }) },
    { label: 'Dodaj na koniec', act: () => placeMedia(m, { t: projectEnd() }) },
    { label: 'Otwórz w monitorze źródła', disabled: m.kind === 'image', act: () => openSource(m.id) },
    { label: 'Zmień nazwę', act: async () => { const v = await ask('Nazwa pliku', m.name, { ok: 'Zapisz' }); if (v?.trim()) { m.name = v.trim(); saveMediaMeta(m); renderBin(); } } },
    { label: 'Zapisz w „Moich assetach”', act: () => saveMediaAsAsset(m) },
    '-',
    ...folderItems,
    '-',
    { label: ids.length > 1 ? `Usuń z projektu (${ids.length})` : 'Usuń z projektu', act: () => { for (const id of ids) removeMedia(id); } },
  ]);
});

function renderPresets() {
  const W = state.w, H = state.h;
  $('#titleList').innerHTML = TITLE_PRESETS.map(p => {
    const s = { ...defaultProps('text'), ...p.p(W, H) };
    const fs = clamp(s.size / H * 90, 9, 26);
    const style = [`font-family:'${s.font}',Inter,sans-serif`, `font-weight:${s.weight}`, `font-size:${fs}px`, `color:${s.color}`,
      s.stroke ? `-webkit-text-stroke:${Math.max(1, s.stroke / H * 120)}px ${s.strokeColor};paint-order:stroke fill` : '',
      s.glow ? `text-shadow:0 0 8px ${s.color}` : '', s.spacing ? `letter-spacing:${s.spacing / 10}px` : '',
      s.upper ? 'text-transform:uppercase' : '', s.align === 'left' ? 'text-align:left;justify-self:start' : '',
      s.rotation ? `transform:rotate(${s.rotation}deg)` : ''].filter(Boolean).join(';');
    const bg = s.bg ? `background:${s.bgColor};padding:2px 6px;border-radius:3px;` : '';
    return `<button class="p-card" draggable="true" data-title="${p.key}" title="Dodaj: ${esc(p.name)}">
      <div class="p-prev"><span style="${style};${bg}">${esc(s.text.split('\n').slice(0, 2).join('\n'))}</span></div><span class="p-name">${esc(p.name)}</span></button>`;
  }).join('');
}
$('#titleList').addEventListener('dragstart', e => {
  const b = e.target.closest('.p-card');
  if (!b) return;
  e.dataTransfer.setData('text/x-kadr-title', b.dataset.title);
  e.dataTransfer.effectAllowed = 'copy';
});
$('#titleList').addEventListener('click', e => {
  const b = e.target.closest('.p-card');
  if (b) addTextClip(b.dataset.title);
});

/* Zakładki */
const tabs = $$('.tabs [role="tab"]');
function selectTab(btn) {
  for (const t of tabs) {
    const on = t === btn;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(`[data-panel="${t.dataset.tab}"]`).hidden = !on;
  }
}
for (const t of tabs) {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', e => {
    const i = tabs.indexOf(t);
    const n = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
    if (n) { e.preventDefault(); selectTab(n); n.focus(); }
  });
}

/* Pliki z systemu */
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging-files'); } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging-files'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging-files');
  importFiles([...e.dataTransfer.files]);
});
$('#btnImport').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });

/* =========================================================
   Inspektor
   ========================================================= */
const FMT = {
  pct: v => Math.round(v * 100) + '%', pc: v => Math.round(v) + '%', px: v => Math.round(v) + ' px',
  deg: v => Math.round(v) + '°', s: v => (+v).toFixed(1) + ' s', n: v => String(Math.round(v * 100) / 100), x: v => (+v).toFixed(2) + '×',
};
const inspClosed = new Set(['crop', 'key', 'lumetri', 'efx']); // sekcje zwinięte na start
const IN_TYPES = [['fade', 'Pojawienie'], ['slide-l', 'Wjazd z lewej'], ['slide-r', 'Wjazd z prawej'], ['slide-u', 'Wjazd z góry'], ['slide-d', 'Wjazd z dołu'], ['zoom-in', 'Powiększenie'], ['zoom-out', 'Najazd z bliska'], ['wipe', 'Odsłonięcie'], ['blur', 'Wyostrzenie'], ['pop', 'Wyskok'], ['spin', 'Obrót'], ['type', 'Maszyna do pisania (napis)']];
const OUT_TYPES = [['fade', 'Zniknięcie'], ['slide-l', 'Wyjazd w lewo'], ['slide-r', 'Wyjazd w prawo'], ['slide-u', 'Wyjazd w górę'], ['slide-d', 'Wyjazd w dół'], ['zoom-in', 'Pomniejszenie'], ['zoom-out', 'Odjazd'], ['wipe', 'Zasłonięcie'], ['blur', 'Rozmycie'], ['spin', 'Obrót']];
const BLENDS = [['source-over', 'Normalny'], ['multiply', 'Mnożenie'], ['screen', 'Rozjaśnianie'], ['overlay', 'Nakładka'], ['soft-light', 'Łagodne światło'],
  ['hard-light', 'Ostre światło'], ['color-dodge', 'Rozjaśnianie kolorem'], ['color-burn', 'Ściemnianie kolorem'], ['lighten', 'Jaśniejszy'], ['darken', 'Ciemniejszy'],
  ['difference', 'Różnica'], ['exclusion', 'Wykluczenie'], ['hue', 'Barwa'], ['saturation', 'Nasycenie'], ['color', 'Kolor'], ['luminosity', 'Jasność'],
  // maska ścieżki (track matte z After Effects): ten klip decyduje, gdzie widać ścieżki pod nim
  ['destination-in', 'Maska ścieżki — niższe ścieżki tylko w tym kształcie'], ['destination-out', 'Maska ścieżki — wytnij ten kształt z niższych ścieżek']];
/* Gotowe zestawy efektów (After Effects / Lumetri) */
const EFX_PRESETS = [
  ['VHS', { grain: 35, rgb: 22, glitch: 12, wave: 6, vibrance: -20 }],
  ['Glitch', { glitch: 70, rgb: 30 }],
  ['Kino', { tintS: '#1f7a8c', tintSAmt: 35, tintH: '#ffad5c', tintHAmt: 30, highlights: -20, shadows: 10, grain: 12 }],
  ['Sen', { glow: 60, highlights: 15, vibrance: 20 }],
  ['Ostry obraz', { sharpen: 45, vibrance: 25 }],
  ['Cenzura', { pixel: 40 }],
  ['Komiks', { posterize: 70, sharpen: 60, vibrance: 40 }],
  ['Kalejdoskop', { mirror: 'q' }],
];
/* Suwak prędkości: w prawo do 100×, w lewo wstecz do −100×, środek = najwolniej (0,1×); skala logarytmiczna,
   więc zakres 0,5–4× zajmuje tyle miejsca co 10–100× */
const SPEED_POS = 1000, SPEED_LOG = Math.log(SPEED_MAX / SPEED_MIN);
const speedToPos = s => (s < 0 ? -1 : 1) * Math.round(SPEED_POS * Math.log(clamp(Math.abs(s), SPEED_MIN, SPEED_MAX) / SPEED_MIN) / SPEED_LOG);
function posToSpeed(p) {
  const mag = SPEED_MIN * Math.exp(SPEED_LOG * Math.abs(p) / SPEED_POS);
  const st = mag < 1 ? 0.05 : mag < 3 ? 0.1 : mag < 10 ? 0.5 : mag < 30 ? 1 : 5; // okrągłe wartości: 0,5× · 1,5× · 2× · 4× · 10× · 25×
  let v = Math.round(mag / st) * st;
  if (Math.abs(v - 1) < 0.06) v = 1; // przyciąganie do normalnej prędkości
  return (p < 0 ? -1 : 1) * +clamp(v, SPEED_MIN, SPEED_MAX).toFixed(2);
}
const speedWord = s => (s < 0 ? 'wstecz' : s === 1 ? 'normalna' : s < 1 ? 'zwolnione' : 'przyspieszone');
const speedDesc = s => (s === 1 ? 'normalna, 1×' : `${speedWord(s)}, ${fmtSpeed(Math.abs(s))}×`);
const speedVal = s => (s < 0 ? '−' : '') + fmtSpeed(Math.abs(s)) + '×';
const SPEED_TICKS = [-100, -10, -1, 1, 10, 100];
const speedFrac = s => 0.5 + speedToPos(s) / SPEED_POS / 2; // miejsce na suwaku (0–1)
const thumbLeft = f => `calc(7px + (100% - 14px) * ${f.toFixed(4)})`; // środek gałki suwaka
const bubbleLeft = s => `clamp(20px, ${thumbLeft(speedFrac(s))}, calc(100% - 20px))`; // dymek nie wychodzi poza panel
function speedField(c) {
  const s = c.speed;
  const tick = v => `<span style="left:${thumbLeft(speedFrac(v))}">${v < 0 ? '−' + -v : v}×</span>`;
  return `<div class="field spd-field">
      <div class="lbl"><label for="c-speed">Prędkość</label>
        <output class="spd-out" id="spdOut" for="c-speed" data-word="${speedWord(s)}"><b>${speedVal(s)}</b> ${speedWord(s)}</output></div>
      <div class="spd-slider">
        <span class="spd-bubble" id="spdBubble" aria-hidden="true" style="left:${bubbleLeft(s)}">${speedVal(s)}</span>
        <input type="range" id="c-speed" data-clip="speed" min="${-SPEED_POS}" max="${SPEED_POS}" step="1" value="${speedToPos(s)}" aria-valuetext="${speedDesc(s)}" title="Przeciągnij: w prawo szybciej, w lewo wolniej, za środkiem — wstecz. Dwuklik: normalna prędkość">
      </div>
      <div class="spd-scale" aria-hidden="true">${SPEED_TICKS.map(tick).join('')}</div>
      <div class="spd-exact"><label for="c-speedNum">Dokładnie</label>
        <input type="text" inputmode="decimal" class="spd-num" id="c-speedNum" data-clip="speedNum" value="${String(s).replace('.', ',')}" spellcheck="false" aria-describedby="spdHint"><span aria-hidden="true">×</span>
        <span class="spd-exact-hint">(minus = wstecz)</span></div>
      <p class="hint" id="spdHint">${speedHint(s)}</p>
      <div class="lbl spd-ramp-lbl">Rampa prędkości</div>
      <div class="chips">${Object.entries(RAMPS).map(([k, r]) => `<button type="button" class="chip${k.startsWith('burst') ? ' chip-hot' : ''}" data-ramp="${k}" title="Dzieli klip na odcinki z płynnie zmienianą prędkością">${r.name}</button>`).join('')}</div>
      <div class="row2 ramp-range">
        <div class="field"><label for="rampLo">Najwolniej (×)</label><input type="number" id="rampLo" min="0.1" max="1" step="0.05" value="${rampPrefs().lo}"></div>
        <div class="field"><label for="rampHi">Najszybciej (×)</label><input type="number" id="rampHi" min="1.5" max="20" step="0.5" value="${rampPrefs().hi}"></div>
      </div>
      <p class="hint">Najwolniej i najszybciej dotyczy czterech pierwszych ramp; „Do 10×” mają tempo gotowe.</p>
    </div>`;
}
function speedHint(s, cut = false) {
  const note = cut ? ' Klip nie zmieścił się w całości przed następnym klipem — koniec nagrania jest ucięty; odsuń następny klip, żeby go odzyskać.' : '';
  if (s < 0) return 'Klip odtwarza się od końca. ' + (s < -16 ? 'W podglądzie obraz idzie skokami, a dźwięk jest wyciszony — eksport jest płynny.' : 'Dźwięk też gra wstecz.') + note;
  if (s > 16) return 'W podglądzie powyżej 16× obraz idzie skokami, a dźwięk jest wyciszony — eksport jest płynny.' + note;
  return (s === 1 ? 'Przeciągnij w prawo, żeby przyspieszyć, w lewo — zwolnić, a za środkiem — odtwarzać wstecz.' : s < 1 ? `Klip trwa ${fmtSpeed(1 / s)} razy dłużej niż nagranie.` : `Klip trwa ${fmtSpeed(s)} razy krócej niż nagranie.`) + note;
}
/* Odświeżenie pola prędkości bez przebudowy inspektora (suwak trzymany myszą zostaje pod kursorem) */
function showSpeed(s, cut = false) {
  const num = $('#c-speedNum'), r = $('#c-speed'), h = $('#spdHint'), out = $('#spdOut'), bub = $('#spdBubble');
  if (num && num !== document.activeElement) num.value = String(s).replace('.', ',');
  if (r) { r.setAttribute('aria-valuetext', speedDesc(s)); if (r !== document.activeElement) r.value = speedToPos(s); paintRange(r); }
  if (out) { out.innerHTML = `<b>${speedVal(s)}</b> ${speedWord(s)}`; out.dataset.word = speedWord(s); }
  if (bub) { bub.textContent = speedVal(s); bub.style.left = bubbleLeft(s); }
  if (h) h.textContent = speedHint(s, cut);
}
/* Czy klip skrócił się względem pełnej długości przy tej prędkości (bo dalej leży następny klip albo kończy się plik) */
function speedCut(c, base) {
  const o = base?.get(c.id);
  if (!o) return false;
  return c.dur < o.dur * Math.abs(o.speed) / Math.abs(c.speed) - frame();
}
let speedBase = null; // klipy sprzed przeciągania suwaka prędkości

/* Klip, którego właściwości pokazuje inspektor: jedyny zaznaczony albo — gdy zaznaczona jest jedna połączona para
   obraz+dźwięk — jej obraz (prędkość i przycinanie i tak zmieniają się w całej parze) */
function single() {
  if (sel.size === 1) return clipById([...sel][0]);
  const s = [...sel].map(clipById).filter(Boolean);
  if (s.length < 2 || !s[0].group || s.some(c => c.group !== s[0].group) || groupMembers(s[0]).length !== s.length) return null;
  return s.find(isVisual) || s[0];
}
const fid = path => 'p-' + path.replace(/\./g, '-');
const opts = (list, v) => list.map(([k, l]) => `<option value="${k}"${String(k) === String(v) ? ' selected' : ''}>${l}</option>`).join('');
function sec(id, title, body) {
  return `<details class="sec" data-sec="${id}"${inspClosed.has(id) ? '' : ' open'}><summary>${title}</summary><div class="sec-body">${body}</div></details>`;
}
function kfBtn(c, path, label) {
  const on = kfIndexAt(c, path, snapLocal(c)) >= 0;
  return `<button type="button" class="kf-btn${hasKf(c, path) ? ' has' : ''}" data-kfbtn="${path}" aria-pressed="${on}" aria-label="Klatka kluczowa: ${label}" title="Klatka kluczowa w miejscu głowicy — animuje „${label}”">◆</button>`;
}
function ctlRange(c, path, label, min, max, step, fmt, kf = false) {
  const v = kf ? pv(c, path, localAt(c)) : getPath(c.props, path);
  const id = fid(path);
  return `<div class="field"><div class="lbl"><label for="${id}">${label}</label><span class="lbl-r"><output id="o-${id}" data-fmt="${fmt}">${FMT[fmt](v)}</output>${kf ? kfBtn(c, path, label) : ''}</span></div>
    <input type="range" id="${id}" data-path="${path}"${kf ? ' data-kf' : ''} min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}
function ctlNum(c, path, label, step = 1, kf = false) {
  const v = kf ? pv(c, path, localAt(c)) : getPath(c.props, path);
  const id = fid(path);
  return `<div class="field"><div class="lbl"><label for="${id}">${label}</label>${kf ? kfBtn(c, path, label) : ''}</div>
    <input type="number" id="${id}" data-path="${path}"${kf ? ' data-kf' : ''} data-num step="${step}" value="${Math.round(v * 100) / 100}"></div>`;
}
const ctlCheck = (c, path, label) => `<label class="check"><input type="checkbox" data-path="${path}"${getPath(c.props, path) ? ' checked' : ''}> ${label}</label>`;
const ctlColor = (c, path, label) => `<div class="field"><label for="${fid(path)}">${label}</label><input type="color" id="${fid(path)}" data-path="${path}" value="${hasKf(c, path) ? pv(c, path, localAt(c)) : getPath(c.props, path)}"></div>`;
const ctlSelect = (c, path, label, list) => `<div class="field"><label for="${fid(path)}">${label}</label><select id="${fid(path)}" data-path="${path}">${opts(list, getPath(c.props, path))}</select></div>`;

/* Gradient napisu: dowolnie wiele kolorów (przycisk „+”), każdy z położeniem 0–100% */
const GRAD_MAX = 16;
const GRAD_PRESETS = [
  ['Zachód', [['#ff7a59', 0], ['#ff3d77', 100]]],
  ['Ocean', [['#12c2e9', 0], ['#2563eb', 100]]],
  ['Złoto', [['#fff3b0', 0], ['#f5b700', 50], ['#b36b00', 100]]],
  ['Neon', [['#00f5d4', 0], ['#9b5de5', 50], ['#f15bb5', 100]]],
  ['Ogień', [['#fff200', 0], ['#ff7b00', 50], ['#d00000', 100]]],
  ['Chrom', [['#ffffff', 0], ['#9aa5b4', 45], ['#ffffff', 55], ['#5b6472', 100]]],
  ['Tęcza', [['#ff3b3b', 0], ['#ff9f1c', 20], ['#ffe066', 40], ['#2ec4b6', 60], ['#3a86ff', 80], ['#8338ec', 100]]],
];
function gradEditor(c) {
  const P = c.props, stops = P.gradStops;
  return `<div class="grad-prev" id="gradPrev" style="background:${gradCss(P)}" aria-hidden="true"></div>
    ${P.fillType === 'linear' ? ctlRange(c, 'gradAngle', 'Kąt gradientu', 0, 360, 1, 'deg') : ''}
    <div class="grad-stops" role="group" aria-label="Kolory gradientu">${stops.map((s, i) => `<div class="grad-stop">
        <input type="color" id="gs-c-${i}" data-path="gradStops.${i}.c" value="${s.c}" aria-label="Kolor ${i + 1}" title="Kolor ${i + 1}">
        <input type="range" id="gs-p-${i}" data-path="gradStops.${i}.p" min="0" max="100" step="1" value="${s.p}" aria-label="Położenie koloru ${i + 1}">
        <output id="o-gs-p-${i}" data-fmt="pc">${Math.round(s.p)}%</output>
        <button type="button" class="icon-btn" data-act="gstop-del" data-i="${i}" aria-label="Usuń kolor ${i + 1}" title="Usuń kolor"${stops.length <= 2 ? ' disabled' : ''}>${ICON.x}</button>
      </div>`).join('')}</div>
    <div class="grad-tools">
      <button type="button" class="btn small" data-act="gstop-add"${stops.length >= GRAD_MAX ? ' disabled' : ''} title="Dodaj kolejny kolor w największej przerwie">+ Dodaj kolor</button>
      <button type="button" class="btn small" data-act="gstop-rev" title="Odwróć kolejność kolorów">⇄ Odwróć</button>
    </div>
    <div class="chips grad-presets">${GRAD_PRESETS.map(([n, s], i) => `<button type="button" class="chip grad-chip" data-gpreset="${i}" title="Gotowy gradient: ${n}"><span style="background:linear-gradient(90deg, ${s.map(([cc, pp]) => `${cc} ${pp}%`).join(', ')})"></span>${n}</button>`).join('')}</div>`;
}
/* kolor pośrodku między dwoma (#rrggbb) — dla nowego koloru w gradiencie */
function mixHex(a, b, t = 0.5) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function gradAction(c, act, i) {
  const P = c.props;
  let s = P.gradStops.map(x => ({ ...x })).sort((a, b) => a.p - b.p);
  if (act === 'gstop-add' && s.length < GRAD_MAX) {
    // nowy kolor w największej przerwie, w połowie drogi między sąsiadami
    let gi = 0;
    for (let k = 1; k < s.length - 1; k++) if (s[k + 1].p - s[k].p > s[gi + 1].p - s[gi].p) gi = k;
    s.splice(gi + 1, 0, { c: mixHex(s[gi].c, s[gi + 1].c), p: Math.round((s[gi].p + s[gi + 1].p) / 2) });
  } else if (act === 'gstop-del' && P.gradStops.length > 2) {
    s = P.gradStops.filter((_, k) => k !== i).map(x => ({ ...x }));
  } else if (act === 'gstop-rev') {
    s = s.reverse().map(x => ({ c: x.c, p: 100 - x.p }));
  } else return false;
  P.gradStops = s;
  return true;
}

function renderInspector() {
  for (const id of [...sel]) if (!clipById(id)) sel.delete(id); // zaznaczenie mogło wskazywać usunięty klip
  const box = $('#inspector');
  const focusId = box.contains(document.activeElement) ? document.activeElement.id : null;
  const st = box.scrollTop;
  const one = single();
  box.innerHTML = one ? clipInspector(one) : sel.size > 1 ? multiInspector() : projectInspector();
  box.scrollTop = st;
  if (focusId) document.getElementById(focusId)?.focus();
}

function projectInspector() {
  const res = [['1920x1080', 'Poziomy 16:9 — 1920×1080'], ['1280x720', 'Poziomy 16:9 — 1280×720'], ['2560x1440', 'Poziomy 2K — 2560×1440'], ['3840x2160', 'Poziomy 4K — 3840×2160'],
    ['1080x1920', 'Pionowy 9:16 — Reels / TikTok / Shorts'], ['1080x1350', 'Pionowy 4:5 — Instagram'], ['1080x1080', 'Kwadrat 1:1'], ['2560x1080', 'Panorama 21:9']];
  const cur = state.w + 'x' + state.h;
  if (!res.some(r => r[0] === cur)) res.push([cur, `Własny — ${state.w}×${state.h}`]);
  return `<p class="insp-title">${esc(project.name)}</p><p class="insp-sub">${plural(state.clips.length, 'klip', 'klipy', 'klipów')} · ${shortDur(projectEnd())} · ${plural(media.size, 'plik', 'pliki', 'plików')}</p>` +
    sec('project', 'Ustawienia projektu', `
      <div class="field"><label for="pr-res">Format</label><select id="pr-res">${opts(res, cur)}</select></div>
      <div class="row2">
        <div class="field"><label for="pr-fps">Klatki/s</label><select id="pr-fps">${opts([24, 25, 30, 50, 60].map(f => [f, f]), state.fps)}</select></div>
        <div class="field"><label for="pr-bg">Tło</label><input type="color" id="pr-bg" value="${state.bg}"></div>
      </div>
      <p class="hint">Format możesz zmienić w każdej chwili — obiekty zostaną na swoich miejscach względem środka kadru.</p>`) +
    sec('tips', 'Jak zacząć', `<ul class="keys">
      <li>Import plików <kbd>${keyLabel('import')}</kbd></li><li>Przeciągnij plik na oś</li><li>Dwuklik pliku → monitor źródła</li>
      <li>Przetnij <kbd>${keyLabel('split')}</kbd></li><li>Żyletka <kbd>${keyLabel('toolBlade')}</kbd></li><li>Odtwarzanie <kbd>${keyLabel('play')}</kbd></li>
      <li>Wszystkie skróty i ich zmiana <kbd>${keysLabel('help')}</kbd></li></ul>`);
}

function multiInspector() {
  const s = selectedClips();
  const vis = s.filter(isVisual).length;
  return `<p class="insp-title">Zaznaczono ${s.length} klipy</p><p class="insp-sub">${shortDur(Math.max(...s.map(clipEnd)) - Math.min(...s.map(c => c.start)))} łącznie</p>` +
    (vis ? sec('looks', 'Filtr dla wszystkich', `<div class="field"><label for="m-filter">Filtr</label><select id="m-filter" data-filtersel>${opts([['', 'Bez filtra'], ...FILTERS.map(f => [f.id, f.name])], '')}</select></div>
      <p class="hint">Wszystkie filtry z podglądem są w zakładce Przejścia → Filtry.</p>`) : '') +
    `<div class="insp-actions">
      <button class="btn small" data-act="link">Połącz w jeden</button>
      ${s.some(c => c.group) ? '<button class="btn small" data-act="unlink">Rozłącz</button>' : ''}
      <button class="btn small" data-act="dup">Duplikuj</button>
      <button class="btn small" data-act="copy">Kopiuj</button>
      <button class="btn small danger" data-act="del">Usuń</button>
    </div>`;
}

function noteInspector(c) {
  return `<p class="insp-title">${ICON.note.replace('<svg', '<svg class="insp-ic" aria-hidden="true"')}Komentarz</p>
    <p class="insp-sub">${esc(trackOf(c).name)} · ${tc(c.start)} → ${tc(clipEnd(c))} · nie pojawia się w filmie</p>
    <div class="field"><label for="n-text">Treść komentarza</label><textarea id="n-text" data-path="text" rows="5" placeholder="Np. tu wyciąć dłuższą pauzę, dodać muzykę…">${esc(c.props.text)}</textarea></div>
    <div class="row2">
      <div class="field"><label for="c-start">Początek (s)</label><input type="number" id="c-start" data-clip="start" min="0" step="0.1" value="${+c.start.toFixed(3)}"></div>
      <div class="field"><label for="c-dur">Długość (s)</label><input type="number" id="c-dur" data-clip="dur" min="0.04" step="0.1" value="${+c.dur.toFixed(3)}"></div>
    </div>
    <div class="insp-actions">
      <button class="btn small" data-act="dup">Duplikuj</button>
      <button class="btn small danger" data-act="del">Usuń</button>
    </div>`;
}
function clipInspector(c) {
  fillDefaults(c);
  if (c.kind === 'note') return noteInspector(c);
  const P = c.props;
  const m = media.get(c.mediaId);
  const kindName = { video: 'Klip wideo', audio: 'Klip audio', image: 'Obraz', text: 'Napis', color: 'Plansza' }[c.kind];
  let h = `<p class="insp-title">${esc(clipLabel(c))}</p>
    <p class="insp-sub">${kindName} · ${esc(trackOf(c).name)} · ${tc(c.start)} → ${tc(clipEnd(c))}${c.group ? ' · połączony' : ''}</p>`;

  let clipBody = `<label class="check"><input type="checkbox" data-clip="off"${c.off ? '' : ' checked'}> Klip włączony <kbd>${keyLabel('toggleOff')}</kbd></label>
    ${c.kind !== 'text' ? `<div class="field"><label for="c-name">Nazwa</label><input type="text" id="c-name" data-clip="name" value="${esc(c.name || '')}"></div>` : ''}
    <div class="row2">
      <div class="field"><label for="c-start">Początek (s)</label><input type="number" id="c-start" data-clip="start" min="0" step="0.1" value="${+c.start.toFixed(3)}"></div>
      <div class="field"><label for="c-dur">Długość (s)</label><input type="number" id="c-dur" data-clip="dur" min="0.04" step="0.1" value="${+c.dur.toFixed(3)}"></div>
    </div>`;
  if (isAV(c)) clipBody += speedField(c);
  h += sec('clip', 'Klip', clipBody);

  if (c.kind === 'text') {
    h += sec('text', 'Tekst', `
      <div class="field"><label for="p-text">Treść${hasKf(c, 'text') ? ' <span class="anim-tag">animowana</span>' : ''}</label><textarea id="p-text" data-path="text" rows="3">${esc(hasKf(c, 'text') ? pv(c, 'text', localAt(c)) : P.text)}</textarea></div>
      <div class="row2">
        <div class="field"><span class="lbl">Krój</span><button type="button" class="font-btn" id="p-font" data-act="font" aria-haspopup="dialog" title="Wybierz spośród wszystkich czcionek Google" style="font-family:'${esc(P.font)}',sans-serif">${esc(P.font)}</button></div>
        ${ctlSelect(c, 'weight', 'Grubość', fontWeights(P.font).map(w => [w, `${WEIGHT_NAMES[w] || w} (${w})`]))}
      </div>
      ${ctlRange(c, 'size', 'Rozmiar', 12, 500, 1, 'px', true)}
      <div class="row2">${ctlSelect(c, 'fillType', 'Wypełnienie', [['solid', 'Jeden kolor'], ['linear', 'Gradient liniowy'], ['radial', 'Gradient kołowy']])}${ctlSelect(c, 'align', 'Wyrównanie', [['left', 'Do lewej'], ['center', 'Do środka'], ['right', 'Do prawej']])}</div>
      ${P.fillType === 'linear' || P.fillType === 'radial' ? gradEditor(c) : ctlColor(c, 'color', 'Kolor')}
      ${ctlRange(c, 'spacing', 'Odstęp liter', -10, 60, 1, 'px', true)}
      ${ctlRange(c, 'lineHeight', 'Interlinia', 0.8, 2.5, 0.05, 'n')}
      <div class="row2">${ctlCheck(c, 'italic', 'Kursywa')}${ctlCheck(c, 'upper', 'WERSALIKI')}</div>
      ${ctlRange(c, 'stroke', 'Obrys', 0, 30, 0.5, 'px')}
      ${P.stroke > 0 ? ctlColor(c, 'strokeColor', 'Kolor obrysu') : ''}
      <div class="row2">${ctlCheck(c, 'shadow', 'Cień')}${ctlCheck(c, 'glow', 'Poświata')}</div>
      ${ctlCheck(c, 'bg', 'Tło pod napisem')}
      ${P.bg ? `<div class="row2">${ctlColor(c, 'bgColor', 'Kolor tła')}<div>${ctlRange(c, 'bgOpacity', 'Krycie tła', 0, 1, 0.01, 'pct')}</div></div>` : ''}`);
  }
  if (c.kind === 'color') {
    h += sec('solid', 'Plansza', `
      ${ctlSelect(c, 'grad', 'Wypełnienie', [['solid', 'Jednolite'], ['linear', 'Gradient liniowy'], ['radial', 'Gradient kołowy']])}
      <div class="row2">${ctlColor(c, 'c1', P.grad === 'solid' ? 'Kolor' : 'Kolor 1')}${P.grad !== 'solid' ? ctlColor(c, 'c2', 'Kolor 2') : ''}</div>
      ${P.grad === 'linear' ? ctlRange(c, 'angle', 'Kąt', 0, 360, 1, 'deg') : ''}`);
  }
  if (c.kind === 'shape') {
    h += sec('shape', 'Kształt', `
      ${ctlSelect(c, 'shape', 'Rodzaj', SHAPE_DEFS.map(d => [d[0], d[1]]))}
      <div class="row2">${ctlNum(c, 'w', 'Szerokość', 1)}${ctlNum(c, 'h', 'Wysokość', 1)}</div>
      <div class="row2">${ctlColor(c, 'fill', 'Wypełnienie')}${ctlColor(c, 'stroke', 'Obrys')}</div>
      ${ctlCheck(c, 'fillOn', 'Wypełniony')}
      ${ctlRange(c, 'strokeW', 'Grubość obrysu', 0, 60, 1, 'px')}
      ${['roundrect', 'callout'].includes(P.shape) ? ctlRange(c, 'corner', 'Zaokrąglenie', 0, 300, 1, 'px') : ''}
      ${P.shape === 'star' ? ctlRange(c, 'points', 'Ramiona gwiazdy', 3, 12, 1, 'n') : ''}`);
  }
  if (c.kind === 'element') {
    const el = P.el;
    h += sec('element', 'Element', `
      ${ctlSelect(c, 'el', 'Rodzaj', ELEMENT_DEFS.map(d => [d[0], d[1]]))}
      <div class="row2">${ctlColor(c, 'color', 'Kolor główny')}${ctlColor(c, 'color2', 'Kolor dodatkowy')}</div>
      ${el === 'countdown' ? ctlRange(c, 'count', 'Odliczanie od', 1, 20, 1, 'n') : ''}
      ${el === 'subscribe' ? `<div class="field"><label for="p-text">Napis na przycisku</label><input type="text" id="p-text" data-path="text" value="${esc(P.text || '')}"></div>` : ''}
      ${el === 'letterbox' ? ctlRange(c, 'ratio', 'Proporcje kadru', 1.5, 3, 0.01, 'n') : ''}
      ${el === 'progress' ? ctlRange(c, 'barH', 'Grubość paska', 2, 80, 1, 'px') : ''}
      ${['lightleak', 'confetti', 'snow', 'bokeh', 'timer', 'bg-gradient', 'bg-dots', 'bg-grid', 'bg-stripes'].includes(el) ? ctlRange(c, 'speed', 'Szybkość', 0.1, 4, 0.05, 'x') : ''}
      ${['lightleak', 'confetti', 'snow', 'bokeh'].includes(el) ? ctlRange(c, 'seed', 'Wariant', 1, 50, 1, 'n') : ''}`);
  }
  if (c.kind === 'adjust') {
    h += `<p class="hint">Warstwa korekcyjna zmienia wszystko, co jest pod nią na niższych ścieżkach wideo — ustaw kolor, LUT albo maskę poniżej.</p>`;
  }
  if (isVisual(c)) {
    const places = [['full', 'Pełny kadr'], ['center', 'Środek ½'], ['tl', 'Okno ↖'], ['tr', 'Okno ↗'], ['bl', 'Okno ↙'], ['br', 'Okno ↘'], ['hl', 'Lewa ½'], ['hr', 'Prawa ½']];
    h += sec('transform', 'Położenie i ruch', `
      ${c.kind !== 'text' ? `<div class="chips">${places.map(([k, l]) => `<button class="chip" data-place="${k}">${l}</button>`).join('')}</div>` : ''}
      ${c.kind === 'video' || c.kind === 'image' ? ctlSelect(c, 'fit', 'Dopasowanie', [['contain', 'Zmieść w kadrze'], ['cover', 'Wypełnij kadr'], ['stretch', 'Rozciągnij']]) : ''}
      ${ctlRange(c, 'scale', 'Skala', 0.05, 4, 0.01, 'pct', true)}
      <div class="row2">${ctlNum(c, 'x', 'Pozycja X', 1, true)}${ctlNum(c, 'y', 'Pozycja Y', 1, true)}</div>
      ${ctlRange(c, 'rotation', 'Obrót', -180, 180, 1, 'deg', true)}
      <div class="chips rot-chips">
        <button type="button" class="chip" data-act="rot" data-d="-90" title="Obróć w lewo o 90°">↺ 90°</button>
        <button type="button" class="chip" data-act="rot" data-d="90" title="Obróć w prawo o 90°">↻ 90°</button>
        <button type="button" class="chip" data-act="rot" data-d="180" title="Obróć do góry nogami">180°</button>
        <button type="button" class="chip" data-act="rot0" title="Bez obrotu">0°</button>
      </div>
      ${ctlRange(c, 'opacity', 'Krycie', 0, 1, 0.01, 'pct', true)}
      ${c.kind !== 'text' ? `<div class="row2">${ctlCheck(c, 'flipH', 'Odbij poziomo')}${ctlCheck(c, 'flipV', 'Odbij pionowo')}</div>
      ${ctlRange(c, 'radius', 'Zaokrąglenie rogów', 0, 400, 1, 'px')}
      ${ctlCheck(c, 'dropShadow', 'Cień pod obrazem')}` : ''}
      ${ctlSelect(c, 'blend', 'Tryb mieszania', BLENDS)}
      ${Object.keys(c.kf || {}).length ? ctlSelect(c, 'kfEase', 'Wygładzanie animacji', [['smooth', 'Płynne (domyślne)'], ['linear', 'Liniowe'], ['in', 'Przyspieszanie'], ['out', 'Hamowanie'], ['back', 'Z odbiciem'], ['bounce', 'Sprężynowanie'], ['elastic', 'Elastyczne'], ['hold', 'Skokowe (bez przejścia)']]) : ''}
      <div class="chips"><button class="chip" data-act="kenburns" title="Powolny najazd kamery przez cały klip">Efekt Kena Burnsa</button>${Object.keys(c.kf || {}).length ? '<button class="chip" data-act="clearkf">Usuń animację</button>' : ''}</div>
      <p class="hint">◆ dodaje klatkę kluczową w miejscu głowicy — ustaw wartości w dwóch miejscach, a obiekt płynnie przejdzie między nimi. Na podglądzie obiekt przesuwasz, skalujesz rogami i obracasz kółkiem nad ramką (z Shift — co 15°).</p>`);
  }
  if (c.kind === 'video' || c.kind === 'image') {
    h += sec('crop', 'Przycięcie kadru', `<div class="row2">
      ${ctlRange(c, 'crop.l', 'Z lewej', 0, 49, 0.5, 'pc')}${ctlRange(c, 'crop.r', 'Z prawej', 0, 49, 0.5, 'pc')}
      ${ctlRange(c, 'crop.t', 'Z góry', 0, 49, 0.5, 'pc')}${ctlRange(c, 'crop.b', 'Z dołu', 0, 49, 0.5, 'pc')}</div>`);
  }
  if (isVisual(c)) {
    const mk = P.mask || { type: 'none' };
    h += sec('mask', 'Maska', `
      ${ctlSelect(c, 'mask.type', 'Kształt maski', [['none', 'Brak'], ['ellipse', 'Elipsa / koło'], ['rect', 'Prostokąt']])}
      ${mk.type !== 'none' ? `<div class="row2">${ctlRange(c, 'mask.w', 'Szerokość', 1, 200, 1, 'pc')}${ctlRange(c, 'mask.h', 'Wysokość', 1, 200, 1, 'pc')}</div>
      <div class="row2">${ctlRange(c, 'mask.x', 'Przesunięcie X', -100, 100, 1, 'pc')}${ctlRange(c, 'mask.y', 'Przesunięcie Y', -100, 100, 1, 'pc')}</div>
      ${ctlRange(c, 'mask.feather', 'Miękka krawędź', 0, 200, 1, 'px')}
      ${mk.type === 'rect' ? ctlRange(c, 'mask.round', 'Zaokrąglenie', 0, 500, 1, 'px') : ''}
      ${ctlCheck(c, 'mask.invert', 'Odwróć (ukryj środek)')}
      <p class="hint">Maska pokazuje tylko część klipu — np. twarz w kółku albo rozmyty fragment z warstwą korekcyjną.</p>` : ''}`);
  }
  if (isVisual(c) && c.kind !== 'text') {
    const canLut = ['video', 'image', 'adjust'].includes(c.kind);
    const lutOpts = [['', 'Brak'], ...BUILTIN_LUTS.map(l => ['b:' + l.id, l.name]), ...userAssets.filter(a => a.kind === 'lut').map(a => ['u:' + a.id, a.name + ' (mój)'])];
    h += sec('color', 'Kolor i filtry', `
      <div class="field"><label for="c-filter">Filtr</label><select id="c-filter" data-filtersel>${opts([['', 'Bez filtra'], ...FILTERS.map(f => [f.id, f.name])], P.filter || '')}</select></div>
      ${P.punch?.amt > 0 ? `<div class="punch-box">
        <h4 class="sub-h">Oddalenie</h4>
        ${ctlRange(c, 'punch.at', 'Początek (od startu klipu)', 0, Math.max(0.1, +(c.dur - 0.05).toFixed(2)), 0.05, 's')}
        <div class="row2">${ctlRange(c, 'punch.dur', 'Czas oddalania', 0.1, 3, 0.05, 's')}${ctlRange(c, 'punch.amt', 'Siła', 0.05, 0.8, 0.01, 'pct')}</div>
        <button class="btn small" data-act="punchhere">Ustaw w miejscu głowicy</button>
      </div>` : ''}
      ${canLut ? `<div class="field"><label for="c-lut">LUT (profesjonalna gradacja kolorów)</label><select id="c-lut" data-clip="lut">${opts(lutOpts, P.lut?.id || '')}</select></div>
      ${P.lut?.id ? ctlRange(c, 'lut.amount', 'Siła LUT', 0, 100, 1, 'pc') : ''}
      <div class="chips"><button class="chip" data-act="lutimport">Importuj .cube…</button><button class="chip" data-act="savelook">Zapisz ten kolor jako asset</button></div>` : ''}
      ${ctlRange(c, 'fx.brightness', 'Jasność', 0, 200, 1, 'pc')}
      ${ctlRange(c, 'fx.contrast', 'Kontrast', 0, 200, 1, 'pc')}
      ${ctlRange(c, 'fx.saturate', 'Nasycenie', 0, 300, 1, 'pc')}
      ${ctlRange(c, 'fx.temp', 'Temperatura', -100, 100, 1, 'n')}
      ${ctlRange(c, 'fx.hue', 'Odcień', -180, 180, 1, 'deg')}
      ${ctlRange(c, 'fx.vignette', 'Winieta', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'fx.blur', 'Rozmycie', 0, 40, 0.5, 'px')}
      ${ctlRange(c, 'fx.grayscale', 'Czerń i biel', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'fx.sepia', 'Sepia', 0, 100, 1, 'pc')}
      <button class="btn small" data-act="resetfx">Wyzeruj kolor</button>`);
  }
  if (['video', 'image', 'adjust'].includes(c.kind)) {
    P.efx ??= { ...EFX0 };
    h += sec('lumetri', 'Korekcja barwna (Lumetri)', `
      ${ctlRange(c, 'efx.exposure', 'Ekspozycja', -100, 100, 1, 'n')}
      ${ctlRange(c, 'efx.highlights', 'Światła', -100, 100, 1, 'n')}
      ${ctlRange(c, 'efx.shadows', 'Cienie', -100, 100, 1, 'n')}
      ${ctlRange(c, 'efx.vibrance', 'Jaskrawość', -100, 100, 1, 'n')}
      <h4 class="sub-h">Tonowanie (kolor cieni i świateł)</h4>
      <div class="row2">${ctlColor(c, 'efx.tintS', 'Kolor cieni')}${ctlColor(c, 'efx.tintH', 'Kolor świateł')}</div>
      <div class="row2">${ctlRange(c, 'efx.tintSAmt', 'Siła w cieniach', 0, 100, 1, 'pc')}${ctlRange(c, 'efx.tintHAmt', 'Siła w światłach', 0, 100, 1, 'pc')}</div>
      <button class="btn small" data-act="resetlum">Wyzeruj korekcję</button>`);
  }
  if (isVisual(c)) {
    const bitmap = ['video', 'image', 'adjust'].includes(c.kind);
    P.shake ??= { ...SHAKE0 };
    h += sec('efx', bitmap ? 'Efekty (jak w After Effects)' : 'Drżenie kamery', `
      ${bitmap ? `<div class="chips">${EFX_PRESETS.map(([n], i) => `<button class="chip" data-efxp="${i}">${n}</button>`).join('')}</div>
      ${ctlRange(c, 'efx.sharpen', 'Wyostrzenie', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'efx.glow', 'Poświata', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'efx.grain', 'Ziarno filmowe', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'efx.pixel', 'Mozaika (piksele)', 0, 100, 1, 'px')}
      ${ctlRange(c, 'efx.rgb', 'Przesunięcie RGB', 0, 100, 1, 'px')}
      ${ctlRange(c, 'efx.glitch', 'Glitch', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'efx.wave', 'Falowanie', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'efx.posterize', 'Posteryzacja', 0, 100, 1, 'pc')}
      ${ctlSelect(c, 'efx.mirror', 'Lustro', [['none', 'Brak'], ['h', 'Lewa połowa odbita w prawo'], ['v', 'Górna połowa odbita w dół'], ['q', 'Kalejdoskop (4 ćwiartki)']])}
      ${ctlCheck(c, 'efx.invert', 'Negatyw')}
      <h4 class="sub-h">Drżenie kamery</h4>` : ''}
      ${ctlRange(c, 'shake.amt', 'Siła drgań', 0, 100, 1, 'pc')}
      ${ctlRange(c, 'shake.freq', 'Częstotliwość', 0.5, 15, 0.5, 'n')}
      ${ctlRange(c, 'shake.rot', 'Kołysanie (obrót)', 0, 100, 1, 'pc')}
      <p class="hint">${bitmap ? 'Efekty na warstwie korekcyjnej działają na wszystko pod nią — z maską np. zamażesz twarz mozaiką. ' : ''}Drżenie to „wiggle” z After Effects: płynne, losowe ruchy kamery (częstotliwość w drganiach na sekundę).</p>
      <button class="btn small" data-act="resetefx">${bitmap ? 'Wyzeruj efekty' : 'Wyłącz drżenie'}</button>`);
  }
  if (c.kind === 'video' || c.kind === 'image') {
    const brushing = keyBrush.on && keyBrush.clipId === c.id;
    h += sec('key', 'Kluczowanie koloru (green screen)', `
      <button type="button" class="btn small key-brush-btn${brushing ? ' primary' : ''}" data-act="keybrush" aria-pressed="${brushing}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 14.6 9.4 12z"/><path d="M8.2 13.2a3.5 3.5 0 0 0-4.9 4.9c-.6 1-1.5 1.7-2.3 1.9 2.3 1.3 5.6 1.2 7.4-.6a3.5 3.5 0 0 0-.2-6.2z"/></svg>
        ${brushing ? 'Zakończ malowanie' : 'Pędzel: pomaluj tło na podglądzie'}</button>
      <p class="hint">${brushing ? 'Maluj po tle, które ma zniknąć — każde pociągnięcie poprawia kolor i tolerancję. Esc kończy.' : 'Pomaluj tło pędzlem, a program sam dobierze kolor i tolerancję — albo ustaw je ręcznie poniżej.'}</p>
      ${ctlCheck(c, 'key.on', 'Usuń tło w kolorach')}
      <div class="key-cols">
        ${keyColors(P.key).map((k, i) => {
          const base = i ? `key.extra.${i - 1}` : 'key', n = i + 1;
          return `<div class="key-col">
            <input type="color" id="${fid(base + '.color')}" data-path="${base}.color" value="${k.color}" aria-label="Kolor tła ${n}">
            <div class="key-col-tol"><div class="lbl"><label for="${fid(base + '.tol')}">Kolor ${n} — tolerancja</label><output id="o-${fid(base + '.tol')}" data-fmt="n">${Math.round(k.tol)}</output></div>
              <input type="range" id="${fid(base + '.tol')}" data-path="${base}.tol" min="0" max="100" step="1" value="${k.tol}"></div>
            <button type="button" class="icon-btn sm" data-act="keyrefine" data-i="${i}" title="Doprecyzuj ten kolor pędzlem" aria-label="Doprecyzuj kolor ${n} pędzlem"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 14.6 9.4 12z"/><path d="M8.2 13.2a3.5 3.5 0 0 0-4.9 4.9c-.6 1-1.5 1.7-2.3 1.9 2.3 1.3 5.6 1.2 7.4-.6a3.5 3.5 0 0 0-.2-6.2z"/></svg></button>
            ${i ? `<button type="button" class="icon-btn sm" data-act="keydel" data-i="${i}" title="Usuń ten kolor" aria-label="Usuń kolor ${n}">${ICON.x}</button>` : (window.EyeDropper ? '<button type="button" class="icon-btn sm" data-act="eyedrop" title="Pobierz kolor z ekranu" aria-label="Pipeta — kolor z ekranu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 4.5 5 5"/><path d="M17 2.8a2.1 2.1 0 0 1 3 3L18.2 7.6l-1.8-1.8z"/><path d="M15.6 6.4 5 17v2.5h2.5L18.1 9"/></svg></button>' : '<span></span>')}
          </div>`;
        }).join('')}
      </div>
      ${keyColors(P.key).length < KEY_MAX ? '<button type="button" class="btn small" data-act="keyadd">+ Dodaj kolor tła (pędzlem)</button>' : '<p class="hint">To już 5 kolorów — najwięcej, ile się da.</p>'}
      ${ctlRange(c, 'key.soft', 'Zmiękczenie krawędzi', 0, 60, 1, 'n')}
      <p class="hint">Połóż ten klip na ścieżce nad tłem (np. V2 nad V1).</p>`);
  }
  if (c.kind === 'audio' || c.kind === 'video') {
    let body;
    if (c.kind === 'video' && P.detached) {
      // po „Rozdziel” para nie jest połączona — dźwięk filmu gra z osobnego klipu albo jest po prostu wyciszony
      const linked = groupMembers(c).some(x => x.kind === 'audio');
      body = `<p class="hint">${linked ? 'Dźwięk tego filmu jest na osobnym, połączonym klipie audio — zaznacz go, żeby zmienić głośność.'
        : 'Dźwięk tego filmu jest tu wyciszony — po „Rozdziel” gra z osobnego klipu na ścieżce audio. Odznacz pole, żeby film znowu grał własny dźwięk.'}</p>${ctlCheck(c, 'detached', linked ? 'Dźwięk na osobnym klipie (wycisza ten)' : 'Wycisz dźwięk tego klipu')}`;
    } else {
      body = `${ctlRange(c, 'volume', 'Głośność', 0, 3, 0.01, 'pct', true)}
        <div class="chips">${m?.peak ? '<button class="chip" data-act="normalize">Normalizuj</button>' : ''}<button class="chip" data-act="mute">Wycisz</button></div>`;
      if (c.kind === 'video') body += ctlCheck(c, 'detached', 'Wycisz dźwięk tego klipu');
    }
    h += sec('audio', 'Dźwięk', body);
    if (!(c.kind === 'video' && P.detached)) {
      P.afx ??= { ...AFX0 };
      h += sec('afx', 'Efekty dźwięku', `
        ${ctlCheck(c, 'afx.voice', 'Wzmocnij głos (filtr, prezencja, kompresja)')}
        ${ctlCheck(c, 'afx.clean', 'Oczyść (usuń dudnienie i syk)')}
        ${ctlCheck(c, 'afx.hum', 'Usuń buczenie sieci 50 Hz')}
        ${ctlCheck(c, 'afx.comp', 'Kompresor (wyrównuje cichsze i głośniejsze)')}
        ${ctlSelect(c, 'afx.voicefx', 'Efekt głosu', [['none', 'Brak'], ['phone', 'Telefon'], ['radio', 'Stare radio'], ['megaphone', 'Megafon'], ['underwater', 'Pod wodą'], ['robot', 'Robot']])}
        ${ctlRange(c, 'afx.reverb', 'Pogłos (sala, kościół)', 0, 100, 1, 'pc')}
        ${ctlRange(c, 'afx.echo', 'Echo', 0, 100, 1, 'pc')}
        <h4 class="sub-h">Korektor</h4>
        ${ctlRange(c, 'afx.bass', 'Basy', -12, 12, 0.5, 'n')}
        ${ctlRange(c, 'afx.mid', 'Środek', -12, 12, 0.5, 'n')}
        ${ctlRange(c, 'afx.treble', 'Soprany', -12, 12, 0.5, 'n')}
        <button class="btn small" data-act="resetafx">Wyzeruj efekty</button>`);
    }
  }
  const maxFade = Math.max(0.1, Math.min(10, c.dur)).toFixed(1);
  const inList = c.kind === 'audio' ? [['fade', 'Narastanie'], ['cross', 'Przenikanie z poprzednim']] : IN_TYPES.filter(t => t[0] !== 'type' || c.kind === 'text');
  const outList = c.kind === 'audio' ? [['fade', 'Wyciszenie']] : OUT_TYPES;
  const inSelect = c.kind === 'audio' ? ctlSelect(c, 'inType', 'Wejście', inList)
    : `<div class="field"><label for="p-inType">Wejście / przejście z poprzedniego klipu</label><select id="p-inType" data-path="inType">
        <optgroup label="Animacja wejścia">${opts(inList, P.inType)}</optgroup>
        <optgroup label="Przejście między klipami">${opts(TRANSITIONS.map(t => [t.id, t.name]), P.inType)}</optgroup></select></div>`;
  h += sec('trans', 'Przejścia i animacja', `
    ${inSelect}
    ${ctlRange(c, 'fadeIn', isTransition(P.inType) ? 'Czas przejścia' : 'Czas wejścia', 0, maxFade, 0.05, 's')}
    ${ctlSelect(c, 'outType', 'Wyjście', outList)}
    ${ctlRange(c, 'fadeOut', 'Czas wyjścia', 0, maxFade, 0.05, 's')}
    ${isTransition(P.inType) ? '<p class="hint">Przejście łączy ten klip z poprzednim, gdy oba stykają się na tej samej ścieżce. Bez poprzedniego klipu działa jak wejście na tło.</p>' : ''}`);

  h += `<div class="insp-actions">
    ${c.kind === 'video' && !P.detached && m?.hasAudio ? '<button class="btn small" data-act="detach">Rozdziel obraz i dźwięk</button>' : ''}
    ${c.kind === 'video' ? '<button class="btn small" data-act="freeze">Stopklatka</button>' : ''}
    ${c.group ? '<button class="btn small" data-act="unlink">Rozłącz</button>' : ''}
    <button class="btn small" data-act="dup">Duplikuj</button>
    <button class="btn small" data-act="saveasset" title="Zapisz w „Moich assetach”, żeby użyć w innych projektach">Zapisz jako asset</button>
    <button class="btn small danger" data-act="del">Usuń</button>
  </div>`;
  return h;
}

/* Odświeżenie wartości animowanych po ruchu głowicy */
function renderInspectorValues() {
  const c = single();
  if (!c) return;
  const box = $('#inspector');
  for (const el of box.querySelectorAll('[data-kf]')) {
    if (el === document.activeElement) continue;
    const v = pv(c, el.dataset.path, localAt(c));
    el.value = el.type === 'number' ? Math.round(v * 100) / 100 : v;
    if (el.type === 'range') paintRange(el);
    const out = $('#o-' + el.id);
    if (out) out.textContent = FMT[out.dataset.fmt](v);
  }
  for (const b of box.querySelectorAll('[data-kfbtn]')) b.setAttribute('aria-pressed', kfIndexAt(c, b.dataset.kfbtn, snapLocal(c)) >= 0);
  // animowana treść i kolor napisu nadążają za głowicą
  for (const n of KF_STR) {
    const el = box.querySelector(`[data-path="${n}"]`);
    if (el && el !== document.activeElement && hasKf(c, n)) el.value = pv(c, n, localAt(c));
  }
}

const inspEl = $('#inspector');
inspEl.addEventListener('toggle', e => {
  const d = e.target;
  if (d.matches?.('details.sec')) d.open ? inspClosed.delete(d.dataset.sec) : inspClosed.add(d.dataset.sec);
}, true);

function readVal(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.dataset.num !== undefined) return parseFloat(el.value) || 0;
  if (el.tagName === 'SELECT' && /^-?\d+(\.\d+)?$/.test(el.value) && el.dataset.path === 'weight') return +el.value;
  return el.value;
}
inspEl.addEventListener('input', e => {
  const el = e.target;
  const c = single();
  if (c && el.id === 'c-speed') {
    speedBase ||= new Map(groupMembers(c).map(x => [x.id, { start: x.start, in: x.in, dur: x.dur, speed: x.speed, kf: structuredClone(x.kf || {}) }]));
    setSpeed(c, posToSpeed(+el.value), speedBase);
    showSpeed(c.speed, speedCut(c, speedBase)); // pokazuje to, co klip naprawdę dostał
    renderLanes(); syncMedia(); drawFrame();
    return;
  }
  if (!c || !el.dataset.path) return;
  const v = readVal(el);
  if (el.hasAttribute('data-kf') || canAnimate(c, el.dataset.path)) setProp(c, el.dataset.path, v); else setPath(c.props, el.dataset.path, v);
  const out = $('#o-' + el.id);
  if (out) out.textContent = FMT[out.dataset.fmt](v);
  if (el.dataset.path === 'text') {
    const t = lanesEl.querySelector(`[data-clip="${c.id}"] .clip-name`);
    if (t) t.lastChild.textContent = clipLabel(c);
  }
  if (el.dataset.path.startsWith('grad') && $('#gradPrev')) $('#gradPrev').style.background = gradCss(c.props);
  syncMedia();
  drawFrame();
});
inspEl.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'rampLo' || el.id === 'rampHi') {
    // zakres prędkości ramp — ustawienie tego komputera, nie klipu
    const p = rampPrefs();
    const v = parseFloat(String(el.value).replace(',', '.'));
    if (el.id === 'rampLo') p.lo = clamp(v || 0.3, 0.1, 1); else p.hi = clamp(v || 3, 1.5, 20);
    el.value = el.id === 'rampLo' ? p.lo : p.hi;
    try { localStorage.setItem('cloudcut-ramp', JSON.stringify(p)); } catch { /* bez zapisu */ }
    return;
  }
  if (el.id === 'pr-res') {
    const [w, h] = el.value.split('x').map(Number);
    state.w = w; state.h = h;
    applyResolution(); commit(); renderPresets(); drawFrame(); return;
  }
  if (el.id === 'pr-fps') { state.fps = +el.value; commit(); updateClock(); drawRuler(); return; }
  if (el.id === 'pr-bg') { state.bg = el.value; commit(); drawFrame(); return; }
  if (el.hasAttribute('data-filtersel')) { applyFilter(el.value || null, selectedClips().filter(isVisual)); $('#' + el.id)?.focus(); return; }
  const c = single();
  if (!c) return;
  if (el.dataset.clip) {
    const f = el.dataset.clip;
    if (f === 'name') c.name = el.value.trim();
    else if (f === 'off') { for (const x of groupMembers(c)) x.off = !el.checked; }
    else if (f === 'lut') c.props.lut = el.value ? { id: el.value, amount: c.props.lut?.amount ?? 100 } : null;
    else if (f === 'speed' || f === 'speedNum') {
      let v = f === 'speed' ? posToSpeed(+el.value) : parseFloat(String(el.value).replace(',', '.').replace('−', '-'));
      if (!isFinite(v) || v === 0) { toast('Wpisz prędkość od −100 do 100 (bez zera), np. 2 albo −1,5'); el.value = String(c.speed).replace('.', ','); return; }
      const base = speedBase || new Map(groupMembers(c).map(x => [x.id, { start: x.start, in: x.in, dur: x.dur, speed: x.speed, kf: structuredClone(x.kf || {}) }]));
      setSpeed(c, v, base);
      speedBase = null;
      if (Math.abs(v) > SPEED_MAX || Math.abs(v) < SPEED_MIN) toast(`Prędkość może być od ${fmtSpeed(SPEED_MIN)}× do ${SPEED_MAX}× (albo tyle samo na minusie) — ustawiono ${speedVal(c.speed)}`, 4000);
      if (speedCut(c, base)) toast('Prędkość ustawiona, ale klip nie zmieścił się przed następnym — koniec nagrania jest ucięty. Odsuń następny klip, żeby go odzyskać.', 6000);
    }
    else {
      const v = Math.max(0, parseFloat(String(el.value).replace(',', '.')) || 0);
      if (f === 'start') {
        const d = v - c.start;
        const members = groupMembers(c);
        const ids = new Set(members.map(x => x.id));
        if (members.every(x => x.start + d >= 0 && !overlaps(x.trackId, x.start + d, clipEnd(x) + d, ids))) for (const x of members) x.start += d;
        else toast('W tym miejscu jest już inny klip');
      } else {
        const m = media.get(c.mediaId);
        let d = Math.max(frame(), v);
        if (isAV(c) && m) d = Math.min(d, c.dur + roomAfter(c, m));
        for (const x of groupMembers(c)) {
          if (overlaps(x.trackId, x.start, x.start + d, x.id)) { toast('Klip nachodziłby na następny'); d = null; break; }
        }
        if (d) for (const x of groupMembers(c)) x.dur = d;
      }
    }
    commit(); renderAll(); return;
  }
  if (el.dataset.path) {
    commit();
    renderLanes();
    if (el.tagName === 'SELECT' || el.type === 'checkbox') renderInspector();
  }
});
inspEl.addEventListener('click', async e => {
  const fontBtn = e.target.closest('[data-act="font"]');
  if (fontBtn) {
    const c = single();
    if (!c) return;
    openFontPicker(fontBtn, c.props.font, async name => {
      c.props.font = name;
      c.props.weight = nearestWeight(name, c.props.weight);
      await ensureFont(name);
      commit(); renderInspector(); renderLanes(); drawFrame();
      $('#p-font')?.focus();
    });
    return;
  }
  const kb = e.target.closest('[data-kfbtn]');
  const place = e.target.closest('[data-place]');
  const actBtn = e.target.closest('[data-act]');
  const c = single();
  if (kb && c) {
    if (toggleKf(c, kb.dataset.kfbtn)) { commit(); renderInspector(); renderLanes(); drawFrame(); }
    return;
  }
  const rampBtn = e.target.closest('[data-ramp]');
  if (rampBtn) { const rc = single(); if (rc) speedRamp(rc, rampBtn.dataset.ramp); return; }
  const efxp = e.target.closest('[data-efxp]');
  if (efxp) {
    // zestaw zastępuje efekty stylizacji, korekcję zostawia (poza tym, co zestaw sam ustawia)
    const [, preset] = EFX_PRESETS[+efxp.dataset.efxp];
    for (const x of selectedClips()) {
      if (!['video', 'image', 'adjust'].includes(x.kind)) continue;
      const keep = Object.fromEntries(LUM_KEYS.map(k => [k, x.props.efx?.[k] ?? EFX0[k]]));
      x.props.efx = { ...EFX0, ...keep, ...preset };
    }
    commit(); renderInspector(); drawFrame();
    return;
  }
  if (place && c) {
    const W = state.w, H = state.h, m = W * 0.03;
    const cfg = {
      full: [1, 0, 0], center: [0.5, 0, 0], hl: [0.5, -W / 4, 0], hr: [0.5, W / 4, 0],
      tl: [0.32, -(W * 0.34 - m), -(H * 0.34 - m)], tr: [0.32, W * 0.34 - m, -(H * 0.34 - m)],
      bl: [0.32, -(W * 0.34 - m), H * 0.34 - m], br: [0.32, W * 0.34 - m, H * 0.34 - m],
    }[place.dataset.place];
    setProp(c, 'scale', cfg[0]); setProp(c, 'x', Math.round(cfg[1])); setProp(c, 'y', Math.round(cfg[2]));
    commit(); renderInspector(); drawFrame();
    return;
  }
  const gpreset = e.target.closest('[data-gpreset]');
  if (gpreset && c) {
    c.props.gradStops = GRAD_PRESETS[+gpreset.dataset.gpreset][1].map(([cc, pp]) => ({ c: cc, p: pp }));
    if (c.props.fillType === 'solid') c.props.fillType = 'linear';
    commit(); renderInspector(); drawFrame();
    $(`[data-gpreset="${gpreset.dataset.gpreset}"]`)?.focus();
    return;
  }
  if (!actBtn) return;
  const act = actBtn.dataset.act;
  if (act.startsWith('gstop-') && c) {
    if (gradAction(c, act, +actBtn.dataset.i)) { commit(); renderInspector(); drawFrame(); }
    (act === 'gstop-add' || act === 'gstop-rev' ? $(`[data-act="${act}"]`) : $('[data-act="gstop-add"]'))?.focus();
    return;
  }
  if (act === 'del') deleteSelected(false);
  else if (act === 'dup') duplicateSelected();
  else if (act === 'copy') copySelected();
  else if (act === 'link') joinSelected();
  else if (act === 'unlink') unlinkSelected();
  else if (act === 'detach' && c) splitAV();
  else if (act === 'freeze') freezeFrame();
  else if (act === 'rot' && c) { rotateClips([c], +actBtn.dataset.d); $(`[data-act="rot"][data-d="${actBtn.dataset.d}"]`)?.focus(); }
  else if (act === 'rot0' && c) { setProp(c, 'rotation', 0); commit(); renderInspector(); drawFrame(); $('[data-act="rot0"]')?.focus(); }
  else if (act === 'punchhere' && c) {
    if (playhead < c.start || playhead >= clipEnd(c)) { toast('Ustaw głowicę na tym klipie'); return; }
    c.props.punch.at = Math.round(clamp(playhead - c.start, 0, Math.max(0, c.dur - c.props.punch.dur)) * 100) / 100;
    commit(); renderInspector(); drawFrame();
  }
  else if (act === 'normalize' && c) normalizeClip(c);
  else if (act === 'mute' && c) { delete c.kf.volume; c.props.volume = 0; commit(); renderInspector(); }
  else if (act === 'resetfx' && c) { c.props.fx = { ...FX0 }; c.props.lut = null; commit(); renderInspector(); drawFrame(); }
  else if (act === 'resetlum' && c) {
    for (const k of LUM_KEYS) c.props.efx[k] = EFX0[k];
    commit(); renderInspector(); drawFrame();
  } else if (act === 'resetefx' && c) {
    const keep = Object.fromEntries(LUM_KEYS.map(k => [k, c.props.efx?.[k] ?? EFX0[k]]));
    c.props.efx = { ...EFX0, ...keep };
    c.props.shake = { ...SHAKE0 };
    commit(); renderInspector(); drawFrame();
  }
  else if (act === 'resetafx' && c) { c.props.afx = { ...AFX0 }; commit(); renderInspector(); syncMedia(); }
  else if (act === 'saveasset' && c) saveClipAsAsset(c);
  else if (act === 'savelook' && c) saveLookAsAsset(c);
  else if (act === 'lutimport') $('#lutInput').click();
  else if (act === 'clearkf' && c) { for (const k of Object.keys(c.kf)) { c.props[k] = pv(c, k, localAt(c)); } c.kf = {}; commit(); renderAll(); }
  else if (act === 'kenburns' && c) {
    const s0 = c.props.scale || 1;
    c.kf.scale = [{ t: 0, v: s0 }, { t: c.dur, v: s0 * 1.18 }];
    c.kf.x = [{ t: 0, v: c.props.x }, { t: c.dur, v: c.props.x - Math.round(state.w * 0.035) }];
    commit(); renderAll();
    toast('Dodano powolny najazd — zmień wartości ◆ na początku lub końcu klipu');
  } else if (act === 'keybrush' && c) {
    if (keyBrush.on && keyBrush.clipId === c.id) stopKeyBrush(); else { stopKeyBrush(); startKeyBrush(c); }
  } else if (act === 'keyadd' && c) {
    stopKeyBrush(); startKeyBrush(c, 'add');
  } else if (act === 'keyrefine' && c) {
    stopKeyBrush(); startKeyBrush(c, +actBtn.dataset.i);
  } else if (act === 'keydel' && c) {
    c.props.key.extra = (c.props.key.extra || []).filter((_, j) => j !== +actBtn.dataset.i - 1);
    if (keyBrush.on) keyBrush.target = 0;
    commit(); renderInspector(); drawFrame();
  } else if (act === 'eyedrop' && c && window.EyeDropper) {
    try {
      const r = await new EyeDropper().open();
      c.props.key.color = r.sRGBHex;
      c.props.key.on = true;
      commit(); renderInspector(); drawFrame();
    } catch { /* anulowano */ }
  }
});

/* =========================================================
   Monitor źródła
   ========================================================= */
let srcMediaId = null;
const srcVideo = $('#srcVideo');
function setMonitor(mode) {
  monitor = mode;
  for (const b of $$('[data-mon]')) b.setAttribute('aria-pressed', b.dataset.mon === mode);
  $('#screenBox').hidden = mode !== 'program';
  $('#sourceBox').hidden = mode !== 'source';
  $('#srcBar').hidden = mode !== 'source' || !srcMediaId;
  if (mode === 'program') srcVideo.pause();
  else if (playing) pause();
  updateSrcUI();
  drawOverlay();
}
function openSource(id) {
  const m = media.get(id);
  if (!m || m.kind === 'image') return;
  srcMediaId = id;
  m.markIn ??= 0;
  m.markOut ??= m.duration;
  srcVideo.src = m.url;
  srcVideo.currentTime = m.markIn;
  $('#srcEmpty').hidden = true;
  const sb = $('#sourceBox');
  sb.classList.toggle('audio', m.kind === 'audio');
  sb.style.backgroundImage = m.kind === 'audio' && m.wave ? `url('${m.wave}')` : '';
  $('#monSourceBtn').textContent = 'Źródło: ' + (m.name.length > 22 ? m.name.slice(0, 21) + '…' : m.name);
  setMonitor('source');
  renderBin();
}
function closeSource() {
  srcMediaId = null;
  srcVideo.pause();
  srcVideo.removeAttribute('src');
  srcVideo.load();
  $('#srcEmpty').hidden = false;
  $('#sourceBox').style.backgroundImage = '';
  $('#monSourceBtn').textContent = 'Źródło';
  if (monitor === 'source') setMonitor('program');
}
function updateSrcUI() {
  const m = media.get(srcMediaId);
  if (!m) return;
  const D = m.duration || 1;
  $('#srcRange').style.left = (m.markIn / D * 100) + '%';
  $('#srcRange').style.width = ((m.markOut - m.markIn) / D * 100) + '%';
  $('#srcHead').style.left = (srcVideo.currentTime / D * 100) + '%';
  $('#srcTc').textContent = `${tc(srcVideo.currentTime)}  ·  fragment ${shortDur(m.markOut - m.markIn)}`;
  $('#srcTrack').setAttribute('aria-valuenow', Math.round(srcVideo.currentTime / D * 100));
  $('#srcPlay').setAttribute('aria-label', srcVideo.paused ? 'Odtwórz źródło' : 'Pauza źródła');
}
function srcLoop() { updateSrcUI(); if (!srcVideo.paused) requestAnimationFrame(srcLoop); }
srcVideo.addEventListener('play', srcLoop);
srcVideo.addEventListener('seeked', updateSrcUI);
srcVideo.addEventListener('pause', updateSrcUI);
function srcMark(which) {
  const m = media.get(srcMediaId);
  if (!m) return;
  const t = srcVideo.currentTime;
  if (which === 'in') { m.markIn = t; if (m.markOut <= t) m.markOut = m.duration; }
  else { m.markOut = Math.max(t, m.markIn + frame()); }
  saveMediaMeta(m);
  updateSrcUI();
}
function srcPlace(mode) {
  const m = media.get(srcMediaId);
  if (!m) return;
  placeMedia(m, { t: playhead, srcIn: m.markIn, srcDur: m.markOut - m.markIn, mode });
  toast(mode === 'insert' ? 'Wstawiono fragment i rozsunięto resztę' : 'Fragment wstawiony w miejscu głowicy');
}
$('#srcPlay').addEventListener('click', () => (srcVideo.paused ? srcVideo.play() : srcVideo.pause()));
$('#srcIn').addEventListener('click', () => srcMark('in'));
$('#srcOut').addEventListener('click', () => srcMark('out'));
$('#srcInsert').addEventListener('click', () => srcPlace('insert'));
$('#srcOverwrite').addEventListener('click', () => srcPlace('overwrite'));
$('#srcTrack').addEventListener('pointerdown', e => {
  const m = media.get(srcMediaId);
  if (!m) return;
  const r = e.currentTarget.getBoundingClientRect();
  const at = ev => { srcVideo.currentTime = clamp((ev.clientX - r.left) / r.width, 0, 1) * m.duration; updateSrcUI(); };
  at(e);
  const up = () => { window.removeEventListener('pointermove', at); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', at);
  window.addEventListener('pointerup', up);
});
for (const b of $$('[data-mon]')) b.addEventListener('click', () => {
  if (b.dataset.mon === 'source' && !srcMediaId) { setMonitor('source'); return; }
  setMonitor(b.dataset.mon);
});

async function snapshotPng() {
  const prev = renderScale;
  const wasSel = new Set(sel);
  setRenderScale(1);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  setRenderScale(prev);
  sel = wasSel;
  downloadBlob(blob, `${safeName($('#projName').value)} ${tc(playhead).replace(/:/g, '-')}.png`);
  toast('Zapisano klatkę PNG w folderze Pobrane');
}

/* =========================================================
   Projekty
   ========================================================= */


/* =========================================================
   Przyciski
   ========================================================= */
function toggleLoop() { loopOn = !loopOn; $('#btnLoop').setAttribute('aria-pressed', loopOn); toast(loopOn ? 'Zapętlanie włączone' : 'Zapętlanie wyłączone', 1500); }
function toggleGuides() { guidesOn = !guidesOn; $('#btnGuides').setAttribute('aria-pressed', guidesOn); drawOverlay(); }

$('#btnPlay').addEventListener('click', togglePlay);
$('#btnPrevEdit').addEventListener('click', () => jumpEdit(-1));
$('#btnNextEdit').addEventListener('click', () => jumpEdit(1));
$('#btnPrev').addEventListener('click', () => seek(playhead - frame()));
$('#btnNext').addEventListener('click', () => seek(playhead + frame()));
$('#btnLoop').addEventListener('click', toggleLoop);
$('#btnMarkIn').addEventListener('click', () => setRangeMark('in'));
$('#btnMarkOut').addEventListener('click', () => setRangeMark('out'));
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#btnHelp').addEventListener('click', () => openKeys());
$('#btnExport').addEventListener('click', () => openExport()); // openExport jest w export.js, ładowanym później
$('#btnProjects').addEventListener('click', () => showHome()); // menu główne jest w home.js
$('#toolSelect').addEventListener('click', () => setTool('select'));
$('#toolBlade').addEventListener('click', () => setTool('blade'));
$('#btnSplit').addEventListener('click', () => splitAt(playhead));
$('#btnSplitAV').addEventListener('click', () => splitAV());
$('#btnFreeze').addEventListener('click', e => freezeMenu(e.currentTarget));
$('#btnDelete').addEventListener('click', () => deleteSelected(false));
$('#btnRipple').addEventListener('click', () => deleteSelected(true));
$('#btnLink').addEventListener('click', joinSelected);
$('#btnText').addEventListener('click', () => addTextClip());
$('#btnComment').addEventListener('click', () => addComment());
$('#btnAddTrack').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: 'Ścieżka wideo', act: () => addTrack('video') },
    { label: 'Ścieżka audio', act: () => addTrack('audio') },
    { label: 'Ścieżka napisów', act: () => addTrack('text') },
    { label: 'Ścieżka komentarzy', act: () => addTrack('note') },
  ]);
});
$('#btnFit').addEventListener('click', zoomFit);
$('#zoom').addEventListener('input', e => setZoom(sliderToPps(+e.target.value)));
$('#btnGuides').addEventListener('click', toggleGuides);
$('#btnSnapshot').addEventListener('click', snapshotPng);
$('#btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('#stage').requestFullscreen?.().catch(() => toast('Pełny ekran jest niedostępny'));
});
document.addEventListener('fullscreenchange', layoutStage);
$('#previewQ').addEventListener('change', e => { if (!exporting) setRenderScale(+e.target.value); });
$('#monVol').addEventListener('input', e => { monVolume = +e.target.value; if (monitorGain) monitorGain.gain.value = monVolume; });
$('#projName').addEventListener('input', e => { project.name = e.target.value.trim() || 'Bez nazwy'; scheduleSave(); });

window.addEventListener('resize', () => { renderLanes(); });
window.addEventListener('beforeunload', e => {
  if (exporting) { e.preventDefault(); e.returnValue = ''; return; }
  if (saveTimer) saveProject();
  if ((!Store.ready && state.clips.length) || Store.uploading?.()) { e.preventDefault(); e.returnValue = ''; }
});


/* Narzędzia osi czasu z nowych modułów (ładowanych po ui.js) */
for (const b of $$('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
$('#btnPro').addEventListener('click', e => openProMenu(e.currentTarget));
$('#btnMixer').addEventListener('click', () => openMixer());
$('#btnKeyPick').addEventListener('click', () => keyPickFromToolbar());
$('#btnRecord').addEventListener('click', () => (rec.dlg?.open ? closeRecorder() : openRecorder()));

/* =========================================================
   Suwaki: wypełnienie do bieżącej wartości (od zera, gdy zakres ma wartości ujemne)
   ========================================================= */
function paintRange(el) {
  const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max, span = max - min || 1;
  el.style.setProperty('--p', clamp((+el.value - min) / span * 100, 0, 100) + '%');
  if (min < 0 && max > 0) { el.dataset.bipolar = ''; el.style.setProperty('--c', (-min / span * 100) + '%'); }
  else { delete el.dataset.bipolar; el.style.setProperty('--c', '0%'); }
  if (el.id === 'c-speed') el.style.setProperty('--c', speedFrac(1) * 100 + '%'); // wypełnienie od normalnej prędkości (1×) do gałki
}
const paintRanges = root => root.querySelectorAll?.('input[type="range"]').forEach(paintRange);
document.addEventListener('input', e => { if (e.target.type === 'range') paintRange(e.target); }, true);
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches('input[type="range"]')) paintRange(n); else paintRanges(n);
  }
}).observe(document.body, { childList: true, subtree: true });
paintRanges(document);

/* Dwuklik na suwaku we Właściwościach przywraca wartość domyślną */
inspEl.addEventListener('dblclick', e => {
  const c = single();
  if (c && e.target.id === 'c-speed') {
    setSpeed(c, c.speed < 0 ? -1 : 1);
    commit(); renderAll();
    $('#c-speed')?.focus();
    toast(c.speed < 0 ? 'Prędkość: −1× (wstecz, normalne tempo)' : 'Prędkość: 1× (normalna)', 1500);
    return;
  }
  const el = e.target.closest('input[type="range"][data-path]');
  if (!el || !c) return;
  const def = getPath(defaultProps(c.kind), el.dataset.path);
  if (typeof def !== 'number') return;
  el.value = def;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  toast('Przywrócono wartość domyślną', 1200);
});
