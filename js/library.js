'use strict';
/* library.js — zakładka „Biblioteka” w menu głównym: czcionki, zdjęcia, filmy, muzyka i LUT-y (.cube) do wszystkich projektów.
   Pliki leżą w „Moich assetach” (na koncie albo w przeglądarce); w edytorze są w Assety → Moje,
   a czcionki rejestrujemy w document.fonts, więc działają w podglądzie, w wyborze czcionek i w eksporcie. */

const LIB_FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];
const LIB_CATS = [['all', 'Wszystko'], ['font', 'Czcionki'], ['image', 'Zdjęcia'], ['video', 'Filmy'], ['audio', 'Audio'], ['lut', 'LUT'], ['style', 'Style i looki']];
let libCat = 'all';

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
async function libAddFiles(files) {
  files = [...files];
  if (!files.length) return;
  if (!Store.ready) { toast('Zapis biblioteki nie działa w tym trybie przeglądarki'); return; }
  const line = $('#libLine');
  line.hidden = false;
  line.className = 'gh-line';
  let added = 0;
  const skipped = [];
  for (const [i, f] of files.entries()) {
    line.textContent = `Dodawanie ${i + 1}/${files.length}: ${f.name}…`;
    const ext = extOf(f.name);
    try {
      if (LIB_FONT_EXT.includes(ext)) {
        const fam = userFontFamily(f.name);
        const face = new FontFace(fam, await f.arrayBuffer());
        await face.load(); // sprawdza, czy to naprawdę czcionka
        await Store.putAsset({ id: uid('a'), kind: 'font', name: f.name.replace(/\.[^.]+$/, ''), data: { family: fam, ext, size: f.size }, fav: false }, f);
      } else if (ext === 'cube') {
        const lut = parseCube(await f.text());
        await Store.putAsset({ id: uid('a'), kind: 'lut', name: f.name.replace(/\.cube$/i, ''), data: lut, fav: false });
      } else {
        const kind = kindOfFile(f);
        if (!kind) { skipped.push(`${f.name} (nieobsługiwany format)`); continue; }
        const m = await probeLibraryFile(f, kind);
        await Store.putAsset({ id: uid('a'), kind: 'media', name: f.name, data: { ...mediaMeta(m), id: undefined }, fav: false }, f);
      }
      added++;
    } catch (err) {
      skipped.push(`${f.name} (${LIB_FONT_EXT.includes(ext) ? 'to nie jest poprawny plik czcionki' : err.message || 'nie udało się odczytać'})`);
    }
  }
  await loadUserAssets();
  renderLibrary();
  line.textContent = `Dodano ${plural(added, 'plik', 'pliki', 'plików')} do Biblioteki${skipped.length ? ` · pominięto: ${skipped.join(', ')}` : ''}.`;
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
function renderLibrary() {
  const counts = Object.fromEntries(LIB_CATS.map(([k]) => [k, k === 'all' ? userAssets.length : userAssets.filter(a => libKind(a) === k).length]));
  $('#libCats').innerHTML = LIB_CATS.filter(([k]) => k === 'all' || counts[k])
    .map(([k, l]) => `<button type="button" data-libcat="${k}" aria-pressed="${libCat === k}">${l} <span class="lib-n">${counts[k]}</span></button>`).join('');
  const q = $('#libSearch').value.trim().toLowerCase();
  const items = userAssets.filter(a => (libCat === 'all' || libKind(a) === libCat) && (!q || a.name.toLowerCase().includes(q)));
  $('#libList').innerHTML = items.length ? items.map(a => `<div class="lib-card" data-lib="${a.id}">
      ${libPreview(a)}
      <div class="lib-info"><span class="lib-name" title="${esc(a.name)}">${esc(a.name)}</span><span class="lib-meta">${esc(libMeta(a))}</span></div>
      <div class="lib-acts">
        <button type="button" class="icon-btn" data-libact="rename" aria-label="Zmień nazwę: ${esc(a.name)}" title="Zmień nazwę"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button type="button" class="icon-btn" data-libact="delete" aria-label="Usuń: ${esc(a.name)}" title="Usuń z Biblioteki">${ICON.x}</button>
      </div></div>`).join('')
    : `<div class="home-empty">${userAssets.length ? 'Nic nie pasuje do wyszukiwania.' : '<strong>Biblioteka jest pusta</strong>Dodaj czcionki, zdjęcia, filmy, muzykę albo LUT-y — będą w każdym projekcie.'}</div>`;
}
$('#libAdd').addEventListener('click', () => $('#libInput').click());
$('#libDrop').addEventListener('click', () => $('#libInput').click());
$('#libInput').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; libAddFiles(f); });
$('#libSearch').addEventListener('input', renderLibrary);
$('#libCats').addEventListener('click', e => { const b = e.target.closest('[data-libcat]'); if (b) { libCat = b.dataset.libcat; renderLibrary(); } });
$('#libList').addEventListener('click', async e => {
  const b = e.target.closest('[data-libact]');
  if (!b) return;
  const a = userAssets.find(x => x.id === b.closest('[data-lib]').dataset.lib);
  if (!a) return;
  if (b.dataset.libact === 'delete') { await deleteMyAsset(a); return; }
  const v = await ask('Nowa nazwa', a.name, { ok: 'Zmień nazwę' });
  if (!v?.trim() || v.trim() === a.name) return;
  // nazwa wyświetlana; czcionka zostaje pod swoją rodziną, żeby projekty z nią dalej działały
  await Store.putAsset({ ...a, name: v.trim() });
  await loadUserAssets();
});
// przeciąganie plików na zakładkę Biblioteka
{
  const zone = $('#hpLibrary');
  const has = e => [...(e.dataTransfer?.types || [])].includes('Files');
  zone.addEventListener('dragover', e => { if (!has(e)) return; e.preventDefault(); e.stopPropagation(); zone.classList.add('lib-dragging'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('lib-dragging'); });
  zone.addEventListener('drop', e => {
    if (!has(e)) return;
    e.preventDefault(); e.stopPropagation(); // nie do importu w edytorze (ui.js), tylko do Biblioteki
    zone.classList.remove('lib-dragging');
    dragDepth = 0;
    document.body.classList.remove('dragging-files');
    libAddFiles(e.dataTransfer.files);
  });
}
