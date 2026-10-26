'use strict';
/* library.js — zakładka „Biblioteka” w menu głównym: czcionki, zdjęcia, filmy, muzyka i LUT-y (.cube) do wszystkich projektów.
   Pliki leżą w „Moich assetach” (na koncie albo w przeglądarce); w edytorze są w Assety → Moje,
   a czcionki rejestrujemy w document.fonts, więc działają w podglądzie, w wyborze czcionek i w eksporcie. */

const LIB_FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];
const LIB_CATS = [['all', 'Wszystko'], ['font', 'Czcionki'], ['image', 'Zdjęcia'], ['video', 'Filmy'], ['audio', 'Audio'], ['lut', 'LUT'], ['style', 'Style i looki']];
let libCat = 'all';
let libFolder = null; // otwarty folder Biblioteki (null = główny)

/* ---------- Foldery ---------- */
const libFolderById = id => libFolders.find(f => f.id === id) || null;
const libParentOf = f => (libFolderById(f.data?.parent) ? f.data.parent : null);
const libFolderOf = a => (libFolderById(a.data?.folder) ? a.data.folder : null); // folder usunięty w innym miejscu = główny
const libChildFolders = id => libFolders.filter(f => libParentOf(f) === id).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
function libFolderPath(id) {
  const out = [];
  for (let f = libFolderById(id), guard = 0; f && guard < 50; f = libFolderById(libParentOf(f)), guard++) out.unshift(f);
  return out;
}
function libFolderFiles(id, deep = false) {
  const ids = new Set([id]);
  if (deep) for (let grew = true; grew;) { grew = false; for (const f of libFolders) if (!ids.has(f.id) && ids.has(libParentOf(f))) { ids.add(f.id); grew = true; } }
  return userAssets.filter(a => ids.has(libFolderOf(a)));
}
/* Folder o tej nazwie w tym miejscu albo nowy — dwa razy wrzucony ten sam folder z dysku trafia do jednego */
async function libEnsureFolder(name, parent) {
  const n = String(name).trim().slice(0, 120) || 'Nowy folder';
  const ex = libFolders.find(f => libParentOf(f) === parent && f.name.toLowerCase() === n.toLowerCase());
  if (ex) return ex.id;
  const f = { id: uid('a'), kind: 'folder', name: n, data: { parent }, fav: false };
  await Store.putAsset(f);
  libFolders.push(f);
  return f.id;
}
async function libNewFolder() {
  if (!Store.ready) { toast('Zapis biblioteki nie działa w tym trybie przeglądarki'); return; }
  const name = await ask('Nazwa folderu', 'Nowy folder', { ok: 'Utwórz' });
  if (!name?.trim()) return;
  await libEnsureFolder(name, libFolder);
  await loadUserAssets();
}
async function libMove(ids, folder) {
  let n = 0;
  for (const id of ids) {
    const a = userAssets.find(x => x.id === id);
    if (!a || libFolderOf(a) === folder) continue;
    await Store.putAsset({ ...a, data: { ...(a.data || {}), folder } });
    n++;
  }
  await loadUserAssets();
  if (n) toast(`Przeniesiono ${plural(n, 'plik', 'pliki', 'plików')} do „${libFolderById(folder)?.name || 'Biblioteka'}”`);
}
async function libDeleteFolder(f) {
  const files = libFolderFiles(f.id), subs = libChildFolders(f.id), up = libParentOf(f);
  const what = [files.length && plural(files.length, 'plik', 'pliki', 'plików'), subs.length && plural(subs.length, 'folder', 'foldery', 'folderów')].filter(Boolean).join(' i ');
  if (!confirm(`Usunąć folder „${f.name}”?${what ? `\n\nJego zawartość (${what}) przeniesie się do „${libFolderById(up)?.name || 'Biblioteka'}” — nic nie zostanie skasowane.` : ''}`)) return;
  for (const a of files) await Store.putAsset({ ...a, data: { ...(a.data || {}), folder: up } });
  for (const s of subs) await Store.putAsset({ ...s, data: { ...(s.data || {}), parent: up } });
  await Store.deleteAsset(f.id);
  if (libFolder === f.id) libFolder = up;
  await loadUserAssets();
}
function libMoveMenu(btn, a) {
  const r = btn.getBoundingClientRect();
  const all = [{ id: null, label: 'Biblioteka (główny)' }, ...libFolders.map(f => ({ id: f.id, label: libFolderPath(f.id).map(x => x.name).join(' › ') }))]
    .sort((x, y) => (x.id === null ? -1 : y.id === null ? 1 : x.label.localeCompare(y.label, 'pl')));
  openMenu(r.left, r.bottom + 4, all.length > 1
    ? all.map(o => ({ label: o.label, disabled: o.id === libFolderOf(a), act: () => libMove([a.id], o.id) }))
    : [{ label: 'Najpierw utwórz folder („+ Nowy folder”)', disabled: true, act: () => {} }]);
}

const libKind = a => (a.kind === 'media' ? a.data?.kind || 'video' : a.kind === 'clip' || a.kind === 'look' ? 'style' : a.kind);
const extOf = name => (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';

/* ---------- Czcionki użytkownika ---------- */
const userFontLoads = new Map(); // rodzina -> Promise<boolean> wczytania
function registerUserFonts() {
  const fonts = userAssets.filter(a => a.kind === 'font');
  for (const [n, info] of FONT_INFO) if (info.user && !fonts.some(a => (a.data?.family || a.name) === n)) FONT_INFO.delete(n);
  for (const a of fonts) {
    const fam = a.data?.family || a.name;
    FONT_INFO.set(fam, { cat: 'mine', weights: [400], pl: true, user: true });
    if (userFontLoads.has(fam)) continue;
    userFontLoads.set(fam, (async () => {
      try {
        const blob = await Store.assetBlob(a);
        if (!blob) return false;
        const face = new FontFace(fam, await blob.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        if (state.clips.some(c => c.kind === 'text' && c.props.font === fam)) drawFrame();
        return true;
      } catch { return false; }
    })());
  }
}
/* Nazwa rodziny z nazwy pliku; jeśli zajęta przez Google Fonts albo inną czcionkę — z dopiskiem */
function userFontFamily(fileName) {
  let base = fileName.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim() || 'Moja czcionka';
  let fam = base, n = 2;
  while (FONT_INFO.has(fam) && !FONT_INFO.get(fam).user) fam = `${base} (moja)`;
  while (userAssets.some(a => a.kind === 'font' && (a.data?.family || a.name) === fam)) fam = `${base} ${n++}`;
  return fam;
}

/* ---------- Dodawanie plików ---------- */
async function probeLibraryFile(f, kind) {
  // to samo co import do projektu (miniatura, długość, fala dźwięku), ale bez dodawania pliku do otwartego projektu
  const m = { id: null, name: f.name, kind, type: f.type, blob: f, url: URL.createObjectURL(f), duration: 0, w: 0, h: 0, hasAudio: false };
  try {
    if (kind === 'video') await probeVideo(m);
    else if (kind === 'audio') await probeAudio(m);
    else await loadImage(m);
    if (m.kind === 'image') m.thumb = await imageThumb(m);
    else await analyzeAudio(m);
    m.markIn = 0;
    m.markOut = m.kind === 'image' ? null : m.duration;
  } finally { URL.revokeObjectURL(m.url); }
  return m;
}
/* Pliki systemowe z folderów (miniatury Windows, ustawienia Findera) pomijamy po cichu */
const LIB_JUNK = /^(desktop\.ini|thumbs\.db|\.ds_store|\._.*)$/i;
/* entries: pliki (trafiają do otwartego folderu) albo { file, folder } z wrzuconych folderów */
async function libAddFiles(entries) {
  const files = [...entries].map(e => (e instanceof Blob ? { file: e, folder: libFolder } : e)).filter(e => !LIB_JUNK.test(e.file.name));
  if (!files.length) return;
  if (!Store.ready) { toast('Zapis biblioteki nie działa w tym trybie przeglądarki'); return; }
  const line = $('#libLine');
  line.hidden = false;
  line.className = 'gh-line';
  let added = 0, dupes = 0;
  const skipped = [];
  for (const [i, { file: f, folder }] of files.entries()) {
    line.textContent = `Dodawanie ${i + 1}/${files.length}: ${f.name}…`;
    const ext = extOf(f.name);
    const put = (a, blob) => Store.putAsset({ ...a, data: { ...(a.data || {}), folder } }, blob);
    // ten sam plik (nazwa i rozmiar) już leży w tym folderze — np. drugi raz wrzucony ten sam folder z dysku
    const base = f.name.replace(/\.[^.]+$/, '');
    if (userAssets.some(a => libFolderOf(a) === folder && (a.size || a.data?.size) === f.size && (a.name === f.name || a.name === base))) { dupes++; continue; }
    try {
      if (LIB_FONT_EXT.includes(ext)) {
        const fam = userFontFamily(f.name);
        const face = new FontFace(fam, await f.arrayBuffer());
        await face.load(); // sprawdza, czy to naprawdę czcionka
        await put({ id: uid('a'), kind: 'font', name: f.name.replace(/\.[^.]+$/, ''), data: { family: fam, ext, size: f.size }, fav: false }, f);
      } else if (ext === 'cube') {
        const lut = parseCube(await f.text());
        await put({ id: uid('a'), kind: 'lut', name: f.name.replace(/\.cube$/i, ''), data: lut, fav: false });
      } else {
        const kind = kindOfFile(f);
        if (!kind) { skipped.push(`${f.name} (nieobsługiwany format)`); continue; }
        const m = await probeLibraryFile(f, kind);
        await put({ id: uid('a'), kind: 'media', name: f.name, data: { ...mediaMeta(m), id: undefined }, fav: false }, f);
      }
      added++;
    } catch (err) {
      skipped.push(`${f.name} (${LIB_FONT_EXT.includes(ext) ? 'to nie jest poprawny plik czcionki' : err.message || 'nie udało się odczytać'})`);
    }
  }
  await loadUserAssets();
  renderLibrary();
  // z całego folderu pominiętych bywa dużo — kilka przykładów zamiast długiej listy
  const skipTxt = skipped.length > 3 ? `${skipped.slice(0, 3).join(', ')} i ${plural(skipped.length - 3, 'inny', 'inne', 'innych')}` : skipped.join(', ');
  line.textContent = `Dodano ${plural(added, 'plik', 'pliki', 'plików')} do Biblioteki${dupes ? ` · ${plural(dupes, 'plik już był', 'pliki już były', 'plików już było')} w tym folderze` : ''}${skipped.length ? ` · pominięto: ${skipTxt}` : ''}.`;
  line.classList.toggle('err', !added && skipped.length > 0);
  if (added) toast(`Dodano ${plural(added, 'plik', 'pliki', 'plików')} do Biblioteki — są we wszystkich projektach`);
}

/* ---------- Zakładka ---------- */
function libPreview(a) {
  const k = libKind(a);
  if (k === 'font') return `<div class="lib-font" style="font-family:'${esc(a.data?.family || a.name)}',sans-serif">Aa Ąą 123</div>`;
  if ((k === 'image' || k === 'video') && a.data?.thumb) return `<div class="lib-thumb" style="background-image:url('${a.data.thumb}')"></div>`;
  if (k === 'audio' && a.data?.wave) return `<div class="lib-thumb lib-wave" style="background-image:url('${a.data.wave}')"></div>`;
  return `<div class="lib-thumb lib-other">${myAssetPreview(a)}</div>`;
}
function libMeta(a) {
  const k = libKind(a);
  const kindName = { font: 'Czcionka', image: 'Zdjęcie', video: 'Film', audio: 'Audio', lut: 'LUT', style: a.kind === 'look' ? 'Zestaw kolorów' : 'Styl klipu' }[k] || 'Plik';
  const extra = k === 'font' ? (a.data?.ext || '').toUpperCase()
    : k === 'lut' ? `${a.data?.size || '?'}³`
    : (k === 'video' || k === 'audio') && a.data?.duration ? shortDur(a.data.duration)
    : k === 'image' && a.data?.w ? `${a.data.w}×${a.data.h}` : '';
  const size = a.size || a.data?.size;
  return [kindName, extra, size ? fmtMB(size) : ''].filter(Boolean).join(' · ');
}
const FOLDER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>';
function renderLibrary() {
  if (libFolder && !libFolderById(libFolder)) libFolder = null;
  const counts = Object.fromEntries(LIB_CATS.map(([k]) => [k, k === 'all' ? userAssets.length : userAssets.filter(a => libKind(a) === k).length]));
  $('#libCats').innerHTML = LIB_CATS.filter(([k]) => k === 'all' || counts[k])
    .map(([k, l]) => `<button type="button" data-libcat="${k}" aria-pressed="${libCat === k}">${l} <span class="lib-n">${counts[k]}</span></button>`).join('');
  const q = $('#libSearch').value.trim().toLowerCase();
  // wyszukiwanie i rodzaj pokazują pliki ze wszystkich folderów; bez nich — zawartość otwartego folderu
  const flat = !!q || libCat !== 'all';
  const path = libFolderPath(libFolder);
  $('#libPath').innerHTML = flat ? '<span class="lib-crumb-note">Wyniki ze wszystkich folderów</span>'
    : [`<button type="button" class="lib-crumb" data-folderdrop="" data-goto=""${libFolder ? '' : ' aria-current="location"'}>Biblioteka</button>`,
      ...path.map((f, i) => `<button type="button" class="lib-crumb" data-folderdrop="${f.id}" data-goto="${f.id}"${i === path.length - 1 ? ' aria-current="location"' : ''}>${esc(f.name)}</button>`)].join('<span class="lib-sep" aria-hidden="true">›</span>');
  const folders = flat ? [] : libChildFolders(libFolder);
  const items = userAssets.filter(a => (flat || libFolderOf(a) === libFolder) && (libCat === 'all' || libKind(a) === libCat) && (!q || a.name.toLowerCase().includes(q)));
  const folderCards = folders.map(f => {
    const n = libFolderFiles(f.id, true).length, sub = libChildFolders(f.id).length;
    return `<div class="lib-card lib-folder" data-folderdrop="${f.id}" data-fid="${f.id}">
      <button type="button" class="lib-open" data-goto="${f.id}" aria-label="Otwórz folder ${esc(f.name)}">${FOLDER_SVG}</button>
      <div class="lib-info"><span class="lib-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="lib-meta">Folder · ${[plural(n, 'plik', 'pliki', 'plików'), sub && plural(sub, 'folder', 'foldery', 'folderów')].filter(Boolean).join(', ')}</span></div>
      <div class="lib-acts">
        <button type="button" class="icon-btn" data-fact="rename" aria-label="Zmień nazwę folderu: ${esc(f.name)}" title="Zmień nazwę"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button type="button" class="icon-btn" data-fact="delete" aria-label="Usuń folder: ${esc(f.name)}" title="Usuń folder (zawartość zostaje)">${ICON.x}</button>
      </div></div>`;
  }).join('');
  const fileCards = items.map(a => `<div class="lib-card" data-lib="${a.id}" draggable="true">
      ${libPreview(a)}
      <div class="lib-info"><span class="lib-name" title="${esc(a.name)}">${esc(a.name)}</span><span class="lib-meta">${esc(libMeta(a))}${flat && libFolderOf(a) ? ` · ${esc(libFolderById(libFolderOf(a)).name)}` : ''}</span></div>
      <div class="lib-acts">
        <button type="button" class="icon-btn" data-libact="move" aria-label="Przenieś do folderu: ${esc(a.name)}" title="Przenieś do folderu" aria-haspopup="menu">${FOLDER_SVG}</button>
        <button type="button" class="icon-btn" data-libact="rename" aria-label="Zmień nazwę: ${esc(a.name)}" title="Zmień nazwę"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button type="button" class="icon-btn" data-libact="delete" aria-label="Usuń: ${esc(a.name)}" title="Usuń z Biblioteki">${ICON.x}</button>
      </div></div>`).join('');
  $('#libList').innerHTML = folderCards || fileCards ? folderCards + fileCards
    : `<div class="home-empty">${flat ? 'Nic nie pasuje do wyszukiwania.' : libFolder ? '<strong>Folder jest pusty</strong>Przeciągnij tu pliki albo karty z Biblioteki.' : '<strong>Biblioteka jest pusta</strong>Dodaj czcionki, zdjęcia, filmy, muzykę albo LUT-y — także całe foldery. Będą w każdym projekcie.'}</div>`;
  if (isHomeOpen() && homeView === 'library') setTimeout(maybeOfferLibSort, 400); // propozycja porządku przy dużym bałaganie (raz)
}
$('#libAdd').addEventListener('click', () => $('#libInput').click());
$('#libAddDir').addEventListener('click', () => $('#libDirInput').click());
$('#libNewFolder').addEventListener('click', () => libNewFolder());
$('#libDrop').addEventListener('click', () => $('#libInput').click());
$('#libInput').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; libAddFiles(f); });
// „Dodaj folder z dysku”: ścieżki względne plików (Folder/Podfolder/plik) odtwarzają układ folderów
$('#libDirInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const ids = new Map();
  const entries = [];
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/').slice(0, -1);
    let parent = libFolder, key = '';
    for (const p of parts) { key += '/' + p; if (!ids.has(key)) ids.set(key, await libEnsureFolder(p, parent)); parent = ids.get(key); }
    entries.push({ file: f, folder: parent });
  }
  await libAddFiles(entries);
});
$('#libSearch').addEventListener('input', renderLibrary);
$('#libCats').addEventListener('click', e => { const b = e.target.closest('[data-libcat]'); if (b) { libCat = b.dataset.libcat; renderLibrary(); } });
$('#libPath').addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) { libFolder = b.dataset.goto || null; renderLibrary(); } });
$('#libList').addEventListener('click', async e => {
  const go = e.target.closest('[data-goto]');
  if (go) { libFolder = go.dataset.goto; renderLibrary(); $('#libPath [aria-current]')?.focus(); return; }
  const fb = e.target.closest('[data-fact]');
  if (fb) {
    const f = libFolderById(fb.closest('[data-fid]').dataset.fid);
    if (!f) return;
    if (fb.dataset.fact === 'delete') { await libDeleteFolder(f); return; }
    const v = await ask('Nowa nazwa folderu', f.name, { ok: 'Zmień nazwę' });
    if (!v?.trim() || v.trim() === f.name) return;
    await Store.putAsset({ ...f, name: v.trim().slice(0, 120) });
    await loadUserAssets();
    return;
  }
  const b = e.target.closest('[data-libact]');
  if (!b) return;
  const a = userAssets.find(x => x.id === b.closest('[data-lib]').dataset.lib);
  if (!a) return;
  if (b.dataset.libact === 'delete') { await deleteMyAsset(a); return; }
  if (b.dataset.libact === 'move') { libMoveMenu(b, a); return; }
  const v = await ask('Nowa nazwa', a.name, { ok: 'Zmień nazwę' });
  if (!v?.trim() || v.trim() === a.name) return;
  // nazwa wyświetlana; czcionka zostaje pod swoją rodziną, żeby projekty z nią dalej działały
  await Store.putAsset({ ...a, name: v.trim() });
  await loadUserAssets();
});

/* Wrzucony z dysku folder: przechodzimy całe drzewo (readEntries oddaje wpisy partiami) */
async function libCollect(entry, folder, out) {
  if (entry.isFile) { out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), folder }); return; }
  if (!entry.isDirectory) return;
  const id = await libEnsureFolder(entry.name, folder);
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const ch of batch) await libCollect(ch, id, out);
  }
}
async function libDropItems(dt, folder) {
  // wpisy trzeba pobrać od razu — po zakończeniu zdarzenia „drop” lista elementów jest już pusta
  const roots = [...(dt.items || [])].map(i => i.kind === 'file' && i.webkitGetAsEntry?.()).filter(Boolean);
  const files = [...dt.files];
  if (!roots.some(r => r.isDirectory)) { libAddFiles(files.map(file => ({ file, folder }))); return; }
  const line = $('#libLine');
  line.hidden = false; line.className = 'gh-line'; line.textContent = 'Czytanie folderów…';
  const out = [];
  try { for (const r of roots) await libCollect(r, folder, out); } catch (err) { toast('Nie udało się odczytać folderu: ' + (err.message || err.name), 5000); }
  await loadUserAssets();
  if (out.length) await libAddFiles(out);
  else line.textContent = 'W folderze nie było plików — utworzono pusty folder.';
}

// przeciąganie: pliki i foldery z dysku na zakładkę albo na kartę folderu; karty Biblioteki na foldery i ścieżkę
{
  const zone = $('#hpLibrary');
  const has = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const isCard = e => [...(e.dataTransfer?.types || [])].includes('text/x-cloudcut-lib');
  const targetOf = e => e.target.closest?.('[data-folderdrop]');
  const mark = el => { for (const x of $$('.lib-drop-on')) if (x !== el) x.classList.remove('lib-drop-on'); el?.classList.add('lib-drop-on'); };
  zone.addEventListener('dragstart', e => {
    const card = e.target.closest?.('[data-lib]');
    if (!card) return;
    e.dataTransfer.setData('text/x-cloudcut-lib', card.dataset.lib);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('lib-moving');
  });
  zone.addEventListener('dragend', e => { e.target.closest?.('[data-lib]')?.classList.remove('lib-moving'); mark(null); });
  zone.addEventListener('dragover', e => {
    if (isCard(e)) {
      const t = targetOf(e);
      mark(t);
      if (t) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
      return;
    }
    if (!has(e)) return;
    e.preventDefault(); e.stopPropagation();
    zone.classList.add('lib-dragging');
    const t = targetOf(e);
    mark(t?.classList.contains('lib-folder') ? t : null);
  });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) { zone.classList.remove('lib-dragging'); mark(null); } });
  zone.addEventListener('drop', e => {
    const t = targetOf(e);
    if (isCard(e)) {
      e.preventDefault();
      mark(null);
      if (t) libMove([e.dataTransfer.getData('text/x-cloudcut-lib')], t.dataset.folderdrop || null);
      return;
    }
    if (!has(e)) return;
    e.preventDefault(); e.stopPropagation(); // nie do importu w edytorze (ui.js), tylko do Biblioteki
    zone.classList.remove('lib-dragging');
    mark(null);
    dragDepth = 0;
    document.body.classList.remove('dragging-files');
    // pliki upuszczone na kartę folderu trafiają do niego, w innym miejscu — do otwartego folderu
    libDropItems(e.dataTransfer, t?.classList.contains('lib-folder') ? t.dataset.folderdrop : libFolder);
  });
}

/* ---------- Biblioteka w edytorze (zakładka obok Mediów) ----------
   Te same foldery co w menu głównym; kliknięcie wstawia plik w miejscu głowicy, przeciągnięcie — tam, gdzie upuścisz */
let elibFolder = null;
function renderEditorLibrary() {
  const list = $('#elibList');
  if (!list) return;
  if (elibFolder && !libFolderById(elibFolder)) elibFolder = null;
  const q = $('#elibSearch').value.trim().toLowerCase();
  const path = libFolderPath(elibFolder);
  $('#elibPath').innerHTML = q ? '<span class="lib-crumb-note">Wyniki ze wszystkich folderów</span>'
    : [`<button type="button" class="lib-crumb" data-egoto=""${elibFolder ? '' : ' aria-current="location"'}>Biblioteka</button>`,
      ...path.map((f, i) => `<button type="button" class="lib-crumb" data-egoto="${f.id}"${i === path.length - 1 ? ' aria-current="location"' : ''}>${esc(f.name)}</button>`)].join('<span class="lib-sep" aria-hidden="true">›</span>');
  const folders = q ? [] : libChildFolders(elibFolder);
  const files = userAssets.filter(a => (q ? a.name.toLowerCase().includes(q) : libFolderOf(a) === elibFolder));
  const what = a => ({ font: 'czcionka — kliknij, żeby użyć w napisie', lut: 'LUT — nałoży się na zaznaczone klipy', style: a.kind === 'look' ? 'zestaw kolorów — na zaznaczone klipy' : 'styl klipu' }[libKind(a)] || 'kliknij albo przeciągnij na oś czasu');
  list.innerHTML = folders.length || files.length ? `<div class="preset-grid">${folders.map(f => `<div class="p-card a-card elib-folder" data-egoto="${f.id}" tabindex="0" role="button" title="Otwórz folder ${esc(f.name)}">
        <div class="p-prev a-prev elib-fprev">${FOLDER_SVG}</div><span class="p-name">${esc(f.name)}</span></div>`).join('')}${files.map(a => `<div class="p-card a-card" draggable="true" data-asset="my:${a.id}" tabindex="0" role="button" title="${esc(a.name)} — ${what(a)}">
        <div class="p-prev a-prev">${libKind(a) === 'font' ? `<div class="ap-text" style="font-family:'${esc(a.data?.family || a.name)}',sans-serif">Aa Ąą</div>` : myAssetPreview(a)}</div>
        <span class="p-name">${esc(a.name)}</span></div>`).join('')}</div>`
    : `<p class="panel-hint">${q ? 'Nic nie pasuje do wyszukiwania.' : userAssets.length || libFolders.length ? 'Ten folder jest pusty.' : 'Biblioteka jest pusta. Kliknij „Zarządzaj”, żeby dodać pliki i całe foldery — będą w każdym projekcie.'}</p>`;
}
$('#elibSearch').addEventListener('input', renderEditorLibrary);
$('#elibManage').addEventListener('click', () => { libFolder = elibFolder; showHome('list', 'library'); });
$('#elibPath').addEventListener('click', e => { const b = e.target.closest('[data-egoto]'); if (b) { elibFolder = b.dataset.egoto || null; renderEditorLibrary(); } });
$('#elibList').addEventListener('click', e => {
  const f = e.target.closest('[data-egoto]');
  if (f) { elibFolder = f.dataset.egoto; renderEditorLibrary(); $('#elibPath [aria-current]')?.focus(); return; }
  const card = e.target.closest('[data-asset]');
  if (card) useAsset(card.dataset.asset);
});
$('#elibList').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest('[data-egoto], [data-asset]');
  if (!t || t !== e.target) return;
  e.preventDefault(); e.stopPropagation();
  t.click();
});
$('#elibList').addEventListener('dragstart', e => {
  const card = e.target.closest('[data-asset]');
  if (!card) return;
  e.dataTransfer.setData('text/x-kadr-asset', card.dataset.asset);
  e.dataTransfer.effectAllowed = 'copy';
});

/* ---------- Porządkowanie Biblioteki jednym kliknięciem ----------
   Pliki z głównego folderu i ze znanych folderów (piosenki, loga, filmiki, obrazki…) trafiają do uporządkowanych
   folderów z podfolderami. Foldery o innych nazwach (własne) zostają nietknięte. Nic nie jest kasowane, a „Cofnij” przywraca stan. */
const lsNorm = s => String(s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\-.…]+/g, ' ').replace(/\s+/g, ' ').trim();
const LS_ALIAS = {
  piosenki: ['Piosenki'], muzyka: ['Piosenki'], music: ['Piosenki'], songs: ['Piosenki'],
  loga: ['Loga'], logo: ['Loga'], logos: ['Loga'],
  filmiki: ['Filmiki'], filmy: ['Filmiki'], wideo: ['Filmiki'], video: ['Filmiki'], animacje: ['Filmiki'],
  obrazki: ['Obrazki'], zdjecia: ['Obrazki'], grafiki: ['Obrazki'], images: ['Obrazki'],
  'efekty dziwkowe': ['Efekty dźwiękowe'], 'efekty dzwiekowe': ['Efekty dźwiękowe'], 'efekty dzwiekowe i muzyka': ['Efekty dźwiękowe'], sfx: ['Efekty dźwiękowe'], dzwieki: ['Efekty dźwiękowe'],
  czcionki: ['Czcionki'], fonty: ['Czcionki'], fonts: ['Czcionki'],
  'swiataczne obrazki': ['Obrazki', 'Świąteczne'], 'swiateczne obrazki': ['Obrazki', 'Świąteczne'], swiateczne: ['Obrazki', 'Świąteczne'],
  'rangi i tagi': ['Obrazki', 'Rangi i tagi'], rangi: ['Obrazki', 'Rangi i tagi'],
};
const LS_TOP = ['Czcionki', 'Loga', 'Piosenki', 'Efekty dźwiękowe', 'Filmiki', 'Obrazki', 'LUT-y', 'Style i looki'];
const LS_MC = /minecraft|minecrafter|minercraft|steve|creeper|ender|nether|portal|cobbl|kowadl|skrzyn|skryzn|perla|flint|\bexp\b|level up|achiv|achiev|obrazenia|jedzenie|plywanie|drewno|kroki|\bgui\b|villager|wither|zombie|enderman|redstone|totem/;
const LS_UNDERTALE = /undertale|deltarune|megalovania|\bsans\b|bonetrousle|fallen down|hopes and dreams|his theme|^home\b|spear of justice|spider dance|ghost fight|your best friend|can you really call this a hotel|death by glamour|heartache|battle against a true hero|snowdin|asgore/;
const LS_XMAS = /christmas|xmas|jingle|santa|deck the halls|swiat[ae]czn|swieta|koled|mikolaj|choink|balwan|cukier|lizak|czekolad|renifer/;
const LS_SFX = /whoosh|swoosh|\bpop\b|klik|click|ding|impact|alarm|pikan|przycisk|zegar|tykan|klaskan|efekt|sound|dzwiek|zdjeci|papier|stron|kamer|komputer|telefon|szkl|ogien|podwod|drzwi|wybuch|beep|powiadom/;
const LS_MC_MUSIC = /c418|sweden|wet hands|aria math|haggstrom|subwoofer|lena raine|pigstep|otherside|minecraft (theme|music|song|soundtrack)/;
const LS_EFFECTS = /\b(absorption|accelerate|bad luck|bad omen|beast surge|blindness|conduit|cool down|critical|darkness|dolphin|dynamo|final shout|fire aspect|fire resistance|food reserves|freezing|glowing|gravity|haste|health boost|hunger|instant damage|instant health|invisibility|jump boost|leeching|levitation|looting|luck|mining fatigue|multishot|nausea|night vision|pain cycle|poison|posion|potion|prospector|protection|regeneration|resistance|roll charge|shadow blast|sharpness|shockwave|slow falling|slowness|smiting|speed|strength|swiftfooted|swirling|unchanting|weakness|wither|efficiency|fortune|mending|unbreaking|knockback|thorns|silk touch|infinity|respiration|feather falling|depth strider|frost walker|soul speed|loyalty|riptide|channeling|impaling|piercing|quick charge|sweeping|water breathing|saturation|hero of the village|trial omen|raid omen|infested|oozing|weaving|wind charged)\b/;
/* Ścieżka folderu dla pliku; top — kategoria wymuszona folderem, w którym użytkownik już go trzymał */
function lsClassify(a, top) {
  const n = lsNorm(a.name.replace(/\.[a-z0-9]{2,5}$/i, '')), k = libKind(a), d = a.data || {};
  const dur = +d.duration || 0, w = +d.w || 0, h = +d.h || 1;
  const gif = /\.gif$/i.test(a.name) || /gif/i.test(a.type || '');
  if (k === 'font') return ['Czcionki', /minecraft|minecrafter|minercraft|craft|pixel|8 ?bit|press start|vt323|silkscreen/.test(n) ? 'Minecraft i pikselowe' : 'Ogólne'];
  if (k === 'lut') return ['LUT-y'];
  if (k === 'style') return ['Style i looki'];
  if (k === 'audio') {
    const und = LS_UNDERTALE.test(n), xmas = LS_XMAS.test(n);
    const sfx = top === 'Efekty dźwiękowe' || (top !== 'Piosenki' && !und && !xmas && (dur < 30 || LS_SFX.test(n) || (LS_MC.test(n) && dur < 90)));
    if (sfx) return ['Efekty dźwiękowe', LS_MC.test(n) ? 'Minecraft' : 'Ogólne'];
    return ['Piosenki', und ? 'Undertale' : xmas ? 'Świąteczne' : LS_MC_MUSIC.test(n) ? 'Minecraft' : 'Ogólne'];
  }
  if (k === 'video') {
    if (/planks|stone|cobble|brick|bambus|bamboo|spruce|\boak\b|birch|dirt|grass block|deepslate|terracotta|concrete|netherrack|obsidian/.test(n) && dur >= 8) return ['Filmiki', 'Tła z bloków Minecraft'];
    if (/\blike\b|\bsub\b|subskryb|komentarz|dolacz|follow|lapka|subscribe/.test(n)) return ['Filmiki', 'YouTube (like, sub, komentarz)'];
    if (/przejsci|transition|przesuwan/.test(n)) return ['Filmiki', 'Przejścia'];
    if (LS_MC.test(n) || /border|zrzut|anarchi|you died|stworz nowy swiat|korona|green screen|zbuduj|\bend\b|\bkrat|^\d{3}$/.test(n)) return ['Filmiki', 'Animacje Minecraft'];
    return ['Filmiki', 'Ogólne'];
  }
  // obrazki: najpierw loga (z folderu „loga” albo po nazwie), potem rodzaje grafik
  const logo = top === 'Loga' || (!gif && (/\blogo\b/.test(n) || /^minecraft/.test(n) || (/anarchia|igrzyska/.test(n) && w / h > 1.8)));
  if (logo) return ['Loga', /minecraft|anarchia|igrzyska|serwer|server|survival|hardcore/.test(n) ? 'Minecraft i serwer' : /premiere|capcut|davinci|resolve|photoshop|after effects|\bobs\b|vegas|filmora|discord|youtube|tiktok|twitch|instagram/.test(n) ? 'Programy i aplikacje' : 'Gry'];
  if (gif) return ['Obrazki', 'GIF-y'];
  if (LS_XMAS.test(n)) return ['Obrazki', 'Świąteczne'];
  if (/admin|helper|moderator|wlasciciel|owner|\bvip\b|ranga|legendarn|niesamowit|radioaktywn|rzadki|pospolit|zabytek|znaki zapytania|epick|mityczn/.test(n)) return ['Obrazki', 'Rangi i tagi'];
  if (/flag/.test(n)) return ['Obrazki', 'Flagi'];
  if (/dystrykt/.test(n)) return ['Obrazki', 'Dystrykty'];
  if (LS_EFFECTS.test(n)) return ['Obrazki', 'Ikony efektów i zaklęć'];
  if (/\bbow\d?\b|sword|miecz|pickaxe|kilof|ingot|diamond|diament|emerald|szmaragd|\bcoal\b|wegiel|netherite|elytra|trident|shield|tarcza|\bfire\b/.test(n)) return ['Obrazki', 'Przedmioty Minecraft'];
  if (/^#\s?\d|zostal otwarty|zmniejsza|napis|kalendarz|skomentuj|subskryb|pink screen|aternos|tablica|\bcps\b|\bfps\b/.test(n)) return ['Obrazki', 'Napisy i plansze'];
  if (/nakladk|\btlo\b|tlem|green screen|particles|ogien|bable\d|slonce|swiecac|\bcien\b|trawa|serca|rzeczy|\bswiat\b|biala mapa|czarne tlo/.test(n)) return ['Obrazki', 'Nakładki i tła'];
  return ['Obrazki', 'Ikony i elementy'];
}
/* Plan porządku: dokąd trafi każdy plik + które istniejące foldery dostaną nowe nazwy */
function libSortPlan() {
  const aliasOf = f => LS_ALIAS[lsNorm(f.name)] || null;
  const folderPathNames = id => libFolderPath(id).map(f => f.name);
  const moves = [], renames = [];
  for (const f of libFolders) {
    const al = libParentOf(f) ? null : aliasOf(f); // przemianowujemy tylko znane foldery główne
    if (al && (al.length > 1 || al[0] !== f.name)) renames.push({ f, path: al });
  }
  for (const a of userAssets) {
    const fid = libFolderOf(a);
    let top = null;
    if (fid) {
      const path = libFolderPath(fid), al = aliasOf(path[0]);
      if (!al) continue; // własny folder użytkownika — nie ruszamy
      if (path.length > 1) continue; // już w podfolderze (posegregowane albo ułożone ręcznie)
      if (al.length > 1) continue; // np. „rangi i tagi” — przenosi się cały folder (zmiana nazwy niżej)
      top = al[0];
    }
    const target = lsClassify(a, top);
    const now = fid ? folderPathNames(fid) : [];
    if (now.join('/') !== target.join('/')) moves.push({ a, from: now, path: target });
  }
  return { moves, renames };
}
function libSortTree(plan) {
  const tree = new Map();
  for (const m of plan.moves) {
    const [top, sub = ''] = m.path;
    if (!tree.has(top)) tree.set(top, new Map());
    const t = tree.get(top);
    if (!t.has(sub)) t.set(sub, []);
    t.get(sub).push(m.a.name);
  }
  return [...tree.entries()].sort((a, b) => LS_TOP.indexOf(a[0]) - LS_TOP.indexOf(b[0]));
}
let libSortDlg = null;
function openLibSort(auto = false) {
  const plan = libSortPlan();
  if (!plan.moves.length) { if (!auto) toast('Biblioteka jest już uporządkowana'); return; }
  if (!libSortDlg) {
    libSortDlg = document.createElement('dialog');
    libSortDlg.className = 'dlg wide';
    libSortDlg.setAttribute('aria-labelledby', 'lsTitle');
    document.body.appendChild(libSortDlg);
  }
  const tree = libSortTree(plan);
  libSortDlg.innerHTML = `<h2 id="lsTitle">✨ Uporządkuj Bibliotekę</h2>
    <p class="hint">Program posegreguje ${plural(plan.moves.length, 'plik', 'pliki', 'plików')} do folderów według rodzaju i nazwy. Nic nie zostanie usunięte, a foldery o własnych nazwach zostaną nietknięte. Potem możesz wszystko cofnąć jednym kliknięciem.</p>
    <div class="ls-tree">${tree.map(([top, subs]) => `<div class="ls-top"><strong>${esc(top)}</strong>
      ${[...subs.entries()].map(([sub, names]) => `<details><summary>${sub ? esc(sub) : '(bez podfolderu)'} <span class="lib-n">${names.length}</span></summary><p class="ls-names">${names.map(esc).join(' · ')}</p></details>`).join('')}</div>`).join('')}</div>
    ${plan.renames.length ? `<p class="hint">Nowe nazwy folderów: ${plan.renames.map(r => `„${esc(r.f.name)}” → „${esc(r.path.join(' › '))}”`).join(', ')}.</p>` : ''}
    <div class="dlg-actions"><button type="button" class="btn" id="lsCancel">${auto ? 'Nie teraz' : 'Anuluj'}</button><button type="button" class="btn primary" id="lsGo">Posegreguj (${plan.moves.length})</button></div>`;
  $('#lsCancel').onclick = () => libSortDlg.close();
  $('#lsGo').onclick = async () => { libSortDlg.close(); await applyLibSort(); };
  libSortDlg.showModal();
  $('#lsGo').focus();
}
const LS_UNDO = 'cloudcut-libsort-undo';
async function applyLibSort() {
  const plan = libSortPlan();
  if (!plan.moves.length) return;
  const undo = { assets: {}, folders: {}, created: [] };
  const line = $('#libLine');
  line.hidden = false; line.className = 'gh-line';
  const before = new Set(libFolders.map(f => f.id));
  // 1) znane foldery dostają porządne nazwy i miejsce (np. „swiataczne obrazki” → Obrazki › Świąteczne)
  const ensurePath = async path => { let parent = null; for (const p of path) parent = await libEnsureFolder(p, parent); return parent; };
  for (const r of plan.renames) {
    const parent = r.path.length > 1 ? await ensurePath(r.path.slice(0, -1)) : null;
    const f = libFolderById(r.f.id);
    undo.folders[f.id] = { name: f.name, parent: libParentOf(f) };
    const nf = { ...f, name: r.path.at(-1), data: { ...(f.data || {}), parent } };
    await Store.putAsset(nf);
    Object.assign(f, nf);
  }
  // 2) pliki do swoich folderów
  let i = 0;
  for (const m of plan.moves) {
    if (++i % 10 === 1) line.textContent = `Porządkowanie Biblioteki… ${i}/${plan.moves.length}`;
    const fid = await ensurePath(m.path);
    undo.assets[m.a.id] = libFolderOf(m.a);
    await Store.putAsset({ ...m.a, data: { ...(m.a.data || {}), folder: fid } });
  }
  undo.created = libFolders.filter(f => !before.has(f.id)).map(f => f.id);
  try { localStorage.setItem(LS_UNDO, JSON.stringify(undo)); } catch { /* bez cofania */ }
  libFolder = null;
  await loadUserAssets();
  line.innerHTML = `✓ Posegregowano ${plural(plan.moves.length, 'plik', 'pliki', 'plików')} do folderów. <button type="button" class="linkbtn" id="lsUndo">Cofnij porządkowanie</button>`;
  $('#lsUndo').onclick = () => undoLibSort();
  toast('Biblioteka uporządkowana');
}
async function undoLibSort() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem(LS_UNDO) || 'null'); } catch { /* brak */ }
  if (!u) { toast('Nie ma czego cofnąć'); return; }
  const line = $('#libLine');
  line.textContent = 'Cofanie porządkowania…';
  for (const [id, folder] of Object.entries(u.assets)) {
    const a = userAssets.find(x => x.id === id);
    if (a) await Store.putAsset({ ...a, data: { ...(a.data || {}), folder } });
  }
  for (const [id, f0] of Object.entries(u.folders)) {
    const f = libFolderById(id);
    if (f) await Store.putAsset({ ...f, name: f0.name, data: { ...(f.data || {}), parent: f0.parent } });
  }
  await loadUserAssets();
  // foldery założone przy porządkowaniu znikają, jeśli zostały puste
  for (const id of [...u.created].reverse()) if (!libFolderFiles(id).length && !libChildFolders(id).length) await Store.deleteAsset(id).then(loadUserAssets);
  try { localStorage.removeItem(LS_UNDO); } catch { /* bez zapisu */ }
  await loadUserAssets();
  line.textContent = 'Przywrócono Bibliotekę sprzed porządkowania.';
}
$('#libSort').addEventListener('click', () => openLibSort());
/* Raz, przy pierwszym wejściu do Biblioteki z dużym bałaganem, program sam proponuje porządek */
function maybeOfferLibSort() {
  if (Store.mode !== 'cloud' || libSortDlg?.open) return;
  try { if (localStorage.getItem('cloudcut-libsort-offered')) return; } catch { return; }
  const loose = userAssets.filter(a => !libFolderOf(a)).length;
  if (loose < 30) return;
  try { localStorage.setItem('cloudcut-libsort-offered', '1'); } catch { /* bez zapisu */ }
  openLibSort(true);
}
