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
const inspClosed = new Set(['crop', 'key']);
const IN_TYPES = [['fade', 'Pojawienie'], ['slide-l', 'Wjazd z lewej'], ['slide-r', 'Wjazd z prawej'], ['slide-u', 'Wjazd z góry'], ['slide-d', 'Wjazd z dołu'], ['zoom-in', 'Powiększenie'], ['zoom-out', 'Najazd z bliska'], ['wipe', 'Odsłonięcie'], ['blur', 'Wyostrzenie'], ['pop', 'Wyskok'], ['spin', 'Obrót'], ['type', 'Maszyna do pisania (napis)']];
const OUT_TYPES = [['fade', 'Zniknięcie'], ['slide-l', 'Wyjazd w lewo'], ['slide-r', 'Wyjazd w prawo'], ['slide-u', 'Wyjazd w górę'], ['slide-d', 'Wyjazd w dół'], ['zoom-in', 'Pomniejszenie'], ['zoom-out', 'Odjazd'], ['wipe', 'Zasłonięcie'], ['blur', 'Rozmycie'], ['spin', 'Obrót']];
const BLENDS = [['source-over', 'Normalny'], ['multiply', 'Mnożenie'], ['screen', 'Rozjaśnianie'], ['overlay', 'Nakładka'], ['soft-light', 'Łagodne światło'], ['lighten', 'Jaśniejszy'], ['darken', 'Ciemniejszy'], ['difference', 'Różnica']];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const single = () => (sel.size === 1 ? clipById([...sel][0]) : null);
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
const ctlColor = (c, path, label) => `<div class="field"><label for="${fid(path)}">${label}</label><input type="color" id="${fid(path)}" data-path="${path}" value="${getPath(c.props, path)}"></div>`;
const ctlSelect = (c, path, label, list) => `<div class="field"><label for="${fid(path)}">${label}</label><select id="${fid(path)}" data-path="${path}">${opts(list, getPath(c.props, path))}</select></div>`;

function renderInspector() {
  for (const id of [...sel]) if (!clipById(id)) sel.delete(id); // zaznaczenie mogło wskazywać usunięty klip
  const box = $('#inspector');
  const focusId = box.contains(document.activeElement) ? document.activeElement.id : null;
  const st = box.scrollTop;
  box.innerHTML = sel.size === 1 ? clipInspector(single()) : sel.size > 1 ? multiInspector() : projectInspector();
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
    (vis ? sec('looks', 'Filtr dla wszystkich', `<div class="chips">${LOOKS.map(l => `<button class="chip" data-look="${l.key}">${l.name}</button>`).join('')}</div>`) : '') +
    `<div class="insp-actions">
      <button class="btn small" data-act="link">${s.some(c => c.group) ? 'Rozłącz' : 'Połącz'}</button>
      <button class="btn small" data-act="dup">Duplikuj</button>
      <button class="btn small" data-act="copy">Kopiuj</button>
      <button class="btn small danger" data-act="del">Usuń</button>
    </div>`;
}

function clipInspector(c) {
  fillDefaults(c);
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
  if (isAV(c)) clipBody += `<div class="field"><label for="c-speed">Prędkość</label><select id="c-speed" data-clip="speed">${opts(SPEEDS.map(s => [s, String(s).replace('.', ',') + '×' + (s === 1 ? ' (normalna)' : s < 1 ? ' (zwolnione)' : ' (przyspieszone)')]), SPEEDS.includes(c.speed) ? c.speed : 1)}</select></div>`;
  h += sec('clip', 'Klip', clipBody);

  if (c.kind === 'text') {
    h += sec('text', 'Tekst', `
      <div class="field"><label for="p-text">Treść</label><textarea id="p-text" data-path="text" rows="3">${esc(P.text)}</textarea></div>
      <div class="row2">
        <div class="field"><span class="lbl">Krój</span><button type="button" class="font-btn" id="p-font" data-act="font" aria-haspopup="dialog" title="Wybierz spośród wszystkich czcionek Google" style="font-family:'${esc(P.font)}',sans-serif">${esc(P.font)}</button></div>
        ${ctlSelect(c, 'weight', 'Grubość', fontWeights(P.font).map(w => [w, `${WEIGHT_NAMES[w] || w} (${w})`]))}
      </div>
      ${ctlRange(c, 'size', 'Rozmiar', 12, 500, 1, 'px')}
      <div class="row2">${ctlColor(c, 'color', 'Kolor')}${ctlSelect(c, 'align', 'Wyrównanie', [['left', 'Do lewej'], ['center', 'Do środka'], ['right', 'Do prawej']])}</div>
      ${ctlRange(c, 'spacing', 'Odstęp liter', -10, 60, 1, 'px')}
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
      ${ctlRange(c, 'opacity', 'Krycie', 0, 1, 0.01, 'pct', true)}
      ${c.kind !== 'text' ? `<div class="row2">${ctlCheck(c, 'flipH', 'Odbij poziomo')}${ctlCheck(c, 'flipV', 'Odbij pionowo')}</div>
      ${ctlRange(c, 'radius', 'Zaokrąglenie rogów', 0, 400, 1, 'px')}
      ${ctlCheck(c, 'dropShadow', 'Cień pod obrazem')}` : ''}
      ${ctlSelect(c, 'blend', 'Tryb mieszania', BLENDS)}
      ${Object.keys(c.kf || {}).length ? ctlSelect(c, 'kfEase', 'Wygładzanie animacji', [['smooth', 'Płynne (domyślne)'], ['linear', 'Liniowe'], ['in', 'Przyspieszanie'], ['out', 'Hamowanie'], ['back', 'Z odbiciem'], ['bounce', 'Sprężynowanie'], ['elastic', 'Elastyczne'], ['hold', 'Skokowe (bez przejścia)']]) : ''}
      <div class="chips"><button class="chip" data-act="kenburns" title="Powolny najazd kamery przez cały klip">Efekt Kena Burnsa</button>${Object.keys(c.kf || {}).length ? '<button class="chip" data-act="clearkf">Usuń animację</button>' : ''}</div>
      <p class="hint">◆ dodaje klatkę kluczową w miejscu głowicy — ustaw wartości w dwóch miejscach, a obiekt płynnie przejdzie między nimi. Obiekt przesuwasz i skalujesz też myszą na podglądzie.</p>`);
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
      <div class="chips">${LOOKS.map(l => `<button class="chip" data-look="${l.key}">${l.name}</button>`).join('')}</div>
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
  if (c.kind === 'video' || c.kind === 'image') {
    h += sec('key', 'Kluczowanie koloru (green screen)', `
      ${ctlCheck(c, 'key.on', 'Usuń tło w kolorze')}
      <div class="row2">${ctlColor(c, 'key.color', 'Kolor tła')}
        <div class="field"><span class="lbl">&nbsp;</span>${window.EyeDropper ? '<button class="btn small" data-act="eyedrop" title="Pobierz kolor z ekranu">Pipeta</button>' : ''}</div></div>
      ${ctlRange(c, 'key.tol', 'Tolerancja', 0, 100, 1, 'n')}
      ${ctlRange(c, 'key.soft', 'Zmiękczenie krawędzi', 0, 60, 1, 'n')}
      <p class="hint">Połóż ten klip na ścieżce nad tłem (np. V2 nad V1).</p>`);
  }
  if (c.kind === 'audio' || c.kind === 'video') {
    let body;
    if (c.kind === 'video' && P.detached) {
      body = `<p class="hint">Dźwięk tego filmu jest na osobnym, połączonym klipie audio — zaznacz go, żeby zmienić głośność.</p>${ctlCheck(c, 'detached', 'Dźwięk na osobnym klipie (wycisza ten)')}`;
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
    ${c.kind === 'video' && !P.detached && m?.hasAudio ? '<button class="btn small" data-act="detach">Odłącz dźwięk</button>' : ''}
    ${c.kind === 'video' ? '<button class="btn small" data-act="freeze">Stopklatka</button>' : ''}
    ${c.group ? '<button class="btn small" data-act="link">Rozłącz</button>' : ''}
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
  if (!c || !el.dataset.path) return;
  const v = readVal(el);
  if (el.hasAttribute('data-kf')) setProp(c, el.dataset.path, v); else setPath(c.props, el.dataset.path, v);
  const out = $('#o-' + el.id);
  if (out) out.textContent = FMT[out.dataset.fmt](v);
  if (el.dataset.path === 'text') {
    const t = lanesEl.querySelector(`[data-clip="${c.id}"] .clip-name`);
    if (t) t.lastChild.textContent = clipLabel(c);
  }
  syncMedia();
  drawFrame();
});
inspEl.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'pr-res') {
    const [w, h] = el.value.split('x').map(Number);
    state.w = w; state.h = h;
    applyResolution(); commit(); renderPresets(); drawFrame(); return;
  }
  if (el.id === 'pr-fps') { state.fps = +el.value; commit(); updateClock(); drawRuler(); return; }
  if (el.id === 'pr-bg') { state.bg = el.value; commit(); drawFrame(); return; }
  const c = single();
  if (!c) return;
  if (el.dataset.clip) {
    const f = el.dataset.clip;
    if (f === 'name') c.name = el.value.trim();
    else if (f === 'off') { for (const x of groupMembers(c)) x.off = !el.checked; }
    else if (f === 'lut') c.props.lut = el.value ? { id: el.value, amount: c.props.lut?.amount ?? 100 } : null;
    else if (f === 'speed') setSpeed(c, +el.value);
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
        if (isAV(c) && m) d = Math.min(d, (m.duration - c.in) / c.speed);
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
  const look = e.target.closest('[data-look]');
  const place = e.target.closest('[data-place]');
  const actBtn = e.target.closest('[data-act]');
  const c = single();
  if (kb && c) {
    if (toggleKf(c, kb.dataset.kfbtn)) { commit(); renderInspector(); renderLanes(); drawFrame(); }
    return;
  }
  if (look) {
    const L = LOOKS.find(l => l.key === look.dataset.look);
    for (const x of selectedClips()) if (x.props.fx) x.props.fx = { ...FX0, ...L.fx };
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
  if (!actBtn) return;
  const act = actBtn.dataset.act;
  if (act === 'del') deleteSelected(false);
  else if (act === 'dup') duplicateSelected();
  else if (act === 'copy') copySelected();
  else if (act === 'link') toggleLink();
  else if (act === 'detach' && c) detachAudio(c);
  else if (act === 'freeze') freezeFrame();
  else if (act === 'normalize' && c) normalizeClip(c);
  else if (act === 'mute' && c) { delete c.kf.volume; c.props.volume = 0; commit(); renderInspector(); }
  else if (act === 'resetfx' && c) { c.props.fx = { ...FX0 }; c.props.lut = null; commit(); renderInspector(); drawFrame(); }
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
function toggleSnap() { snapOn = !snapOn; $('#btnSnap').setAttribute('aria-pressed', snapOn); }

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
$('#btnDelete').addEventListener('click', () => deleteSelected(false));
$('#btnRipple').addEventListener('click', () => deleteSelected(true));
$('#btnLink').addEventListener('click', toggleLink);
$('#btnMarker').addEventListener('click', () => addMarker());
$('#btnText').addEventListener('click', () => addTextClip());
$('#btnAddTrack').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: 'Ścieżka wideo', act: () => addTrack('video') },
    { label: 'Ścieżka audio', act: () => addTrack('audio') },
    { label: 'Ścieżka napisów', act: () => addTrack('text') },
  ]);
});
$('#btnSnap').addEventListener('click', toggleSnap);
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

/* =========================================================
   Suwaki: wypełnienie do bieżącej wartości (od zera, gdy zakres ma wartości ujemne)
   ========================================================= */
function paintRange(el) {
  const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max, span = max - min || 1;
  el.style.setProperty('--p', clamp((+el.value - min) / span * 100, 0, 100) + '%');
  if (min < 0 && max > 0) { el.dataset.bipolar = ''; el.style.setProperty('--c', (-min / span * 100) + '%'); }
  else { delete el.dataset.bipolar; el.style.setProperty('--c', '0%'); }
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
  const el = e.target.closest('input[type="range"][data-path]');
  const c = single();
  if (!el || !c) return;
  const def = getPath(defaultProps(c.kind), el.dataset.path);
  if (typeof def !== 'number') return;
  el.value = def;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  toast('Przywrócono wartość domyślną', 1200);
});
