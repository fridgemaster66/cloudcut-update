'use strict';
/* home.js — menu główne: po zalogowaniu lista projektów, nowy projekt w wybranym formacie, kosz */

const homeEl = $('#homeScreen');
let homeTab = 'list';
let homeCache = [];
const homeSel = new Set();   // zaznaczone projekty (pasek: Duplikuj, Eksportuj, Usuń, Zapisz na GitHub)
const HOME_FORMATS = [
  { name: 'Film / YouTube', sub: '16:9 · 1920×1080', w: 1920, h: 1080 },
  { name: 'Film 4K', sub: '16:9 · 3840×2160', w: 3840, h: 2160 },
  { name: 'Rolka / TikTok', sub: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { name: 'Instagram', sub: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { name: 'Kwadrat', sub: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { name: 'Kinowy', sub: '21:9 · 2560×1080', w: 2560, h: 1080 },
];
const isHomeOpen = () => !homeEl.hidden;

function relTime(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'przed chwilą';
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return `${Math.floor(s / 3600)} godz. temu`;
  if (s < 172800) return 'wczoraj';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} dni temu`;
  return new Date(ms).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
}
const plFiles = n => plural(n, 'plik', 'pliki', 'plików');

async function showHome(tab = 'list', view = 'projects') {
  if (!Store.ready) { toast('Zapis projektów nie działa w tym trybie przeglądarki (np. okno prywatne)'); return; }
  if (playing) pause();
  await closeRecorder(); // mikrofon nie zostaje włączony pod menu, a nagranie trafia do tego projektu
  await flushSave();
  closeMenu();
  homeTab = Store.mode === 'cloud' ? tab : 'list';
  homeEl.hidden = false;
  document.body.classList.add('home-open');
  homeNav(view);
  $('#hnAccountDot').hidden = !(Store.mode === 'cloud' && Store.user.initialPassword);
  const cloud = Store.mode === 'cloud';
  const who = cloud ? Store.user.email.split('@')[0] : '';
  const h = new Date().getHours();
  $('#homeHello').textContent = `${h < 5 ? 'Dobry wieczór' : h < 18 ? 'Dzień dobry' : 'Dobry wieczór'}${who ? ', ' + who : ''}`;
  $('#homeSub').textContent = cloud
    ? (IS_DESKTOP ? 'Projekty zapisują się na tym komputerze. Zaznacz wybrane i kliknij „Zapisz na GitHub”, żeby mieć kopię w chmurze.'
      : 'Projekty są na Twoim koncie — otworzysz je na każdym komputerze.')
    : `Pracujesz bez konta — projekty są tylko ${IS_DESKTOP ? 'na tym komputerze' : 'w tej przeglądarce'}.`;
  $('#homeAvatar').textContent = cloud ? Store.user.email[0].toUpperCase() : '?';
  $('#homeMail').textContent = cloud ? Store.user.email : 'Zaloguj się';
  $('#homeAccount').classList.toggle('local', !cloud);
  $('#homeAccount').classList.toggle('warn', cloud && !!Store.user.initialPassword);
  $('#homeTrashTab').hidden = !cloud;
  $('#homeBack').hidden = !project.id;
  for (const b of $$('[data-htab]')) b.setAttribute('aria-pressed', b.dataset.htab === homeTab);
  renderNewGrid();
  await ghLoad();
  await loadHomeList();
  ghRenderProgress();
  updAutoCheck();
  if (view === 'projects') setTimeout(() => (homeEl.querySelector('.home-continue:not([hidden])') || homeEl.querySelector('.new-card'))?.focus(), 0);
}
function hideHome() {
  leaveHomeView();
  homeEl.hidden = true;
  document.body.classList.remove('home-open');
  layoutStage();
  renderLanes();
}

/* ---------- Zakładki po lewej: Projekty, Ustawienia, Konto ---------- */
let homeView = 'projects';
const HOME_VIEWS = { projects: 'hpProjects', github: 'hpGithub', library: 'hpLibrary', updates: 'hpUpdates', settings: 'hpSettings', account: 'hpAccount' };
function leaveHomeView() {
  // niezapisane pola GitHuba i aktualizacji zapisują się przy wyjściu z Ustawień
  if (homeView === 'settings') { ghAutoSave(); updAutoSave(); }
}
function homeNav(view, focusTab = false) {
  if (!HOME_VIEWS[view]) view = 'projects';
  if (view !== homeView) leaveHomeView();
  homeView = view;
  for (const b of $$('[data-hnav]')) {
    const on = b.dataset.hnav === view;
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
    if (on && focusTab) b.focus();
  }
  for (const [v, id] of Object.entries(HOME_VIEWS)) $('#' + id).hidden = v !== view;
  $('#homeBody').scrollTop = 0;
  if (view === 'settings') {
    $('#homeSetHost').appendChild($('#setBody')); // ta sama treść co w oknie Ustawień edytora
    renderSettings();
    ghFilling = ghFillSettings();
    updFill();
  }
  if (view === 'account') renderAccount();
  if (view === 'github') ghpLoad();
  if (view === 'library') renderLibrary();
  if (view === 'updates') updpLoad();
}
$('.hn-tabs').addEventListener('click', e => { const b = e.target.closest('[data-hnav]'); if (b) homeNav(b.dataset.hnav); });
$('.hn-tabs').addEventListener('keydown', e => {
  const tabs = $$('[data-hnav]'), i = tabs.indexOf(document.activeElement);
  const n = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (i < 0 || !n) return;
  e.preventDefault();
  homeNav(tabs[(i + n + tabs.length) % tabs.length].dataset.hnav, true);
});
$('#homeSetReset').addEventListener('click', () => $('#setReset').click());

/* ---------- Konto ---------- */
async function renderAccount() {
  const cloud = Store.mode === 'cloud';
  renderAvatarGrid();
  for (const id of ['#accCard', '#accPassBox', '#accMore']) $(id).hidden = !cloud;
  $('#accLocal').hidden = cloud;
  if (!cloud) return;
  $('#accCardAvatar').textContent = Store.user.email[0].toUpperCase();
  $('#accEmail').textContent = Store.user.email;
  $('#accPassInfo').textContent = Store.user.initialPassword
    ? 'Używasz hasła początkowego — ustaw własne. Wpisz obecne hasło, a potem dwa razy nowe.'
    : 'Wpisz obecne hasło, a potem dwa razy nowe.';
  $('#accPassInfo').classList.toggle('warn-text', !!Store.user.initialPassword);
  const st = await Store.stats().catch(() => null);
  $('#accStats').textContent = st
    ? `${plural(st.projects, 'projekt', 'projekty', 'projektów')} · ${plFiles(st.media)} (${fmtMB(st.mediaBytes)}) · ${plural(st.assets, 'asset', 'assety', 'assetów')}`
    : '';
}
$('#accPassForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#accPassMsg'), btn = $('#accPassSave');
  msg.className = 'gh-result';
  btn.disabled = true;
  try {
    await changePassword($('#accOld').value, $('#accNew').value, $('#accNew2').value);
    for (const id of ['#accOld', '#accNew', '#accNew2']) $(id).value = '';
    msg.classList.add('ok');
    msg.textContent = '✓ Hasło zostało zmienione. Przy następnym logowaniu użyj nowego.';
    $('#hnAccountDot').hidden = true;
    renderAccount();
  } catch (ex) {
    msg.classList.add('err');
    msg.textContent = ex.message;
  }
  btn.disabled = false;
});
$('#accShow').addEventListener('change', e => {
  for (const id of ['#accOld', '#accNew', '#accNew2']) $(id).type = e.target.checked ? 'text' : 'password';
});
$('#accMigrate').addEventListener('click', async () => { await offerMigration(true); loadHomeList(); renderAccount(); });
$('#accLogout').addEventListener('click', () => logout());
$('#accDelete').addEventListener('click', () => deleteAccount());
$('#accLogin').addEventListener('click', () => { homeEl.hidden = true; document.body.classList.remove('home-open'); showAuth(); });

function renderNewGrid() {
  $('#homeNew').innerHTML = HOME_FORMATS.map((f, i) => {
    const k = 46 / Math.max(f.w, f.h);
    return `<button type="button" class="new-card" data-fmt="${i}">
      <span class="nc-frame"><span style="width:${Math.round(f.w * k)}px;height:${Math.round(f.h * k)}px"></span></span>
      <span class="nc-name">${f.name}</span><span class="nc-sub">${f.sub}</span></button>`;
  }).join('');
}

async function loadHomeList() {
  const list = $('#homeList');
  list.innerHTML = '<p class="hint">Wczytywanie…</p>';
  try {
    homeCache = homeTab === 'trash' ? await Store.listTrash() : ((await Store.listProjects()) || []);
  } catch {
    list.innerHTML = '<p class="hint">Nie udało się pobrać projektów — sprawdź połączenie z serwerem.</p>';
    return;
  }
  renderHomeList();
  // „Kontynuuj pracę”: ostatnio edytowany projekt
  const recent = homeTab === 'list' ? [...homeCache].sort((a, b) => b.updated - a.updated)[0] : null;
  const cont = $('#homeContinue');
  cont.hidden = !recent;
  if (recent) {
    cont.dataset.id = recent.id;
    $('#homeContName').textContent = recent.name;
    $('#homeContMeta').textContent = `${relTime(recent.updated)} · ${shortDur(recent.duration || 0)}`;
    $('#homeContThumb').style.backgroundImage = recent.thumb ? `url('${recent.thumb}')` : '';
  }
  const st = await Store.stats().catch(() => null);
  $('#homeStats').textContent = st
    ? `${plural(st.projects, 'projekt', 'projekty', 'projektów')} · ${plFiles(st.media)} (${(st.mediaBytes / 1048576).toFixed(0)} MB) · ${plural(st.versions, 'zapisana wersja', 'zapisane wersje', 'zapisanych wersji')} · w koszu ${st.trash} (kosz opróżnia się po 30 dniach)`
    : IS_DESKTOP ? 'Projekty i pliki są zapisane na tym komputerze bez konta. Zaloguj się, żeby mieć kosz, historię wersji i zapis na GitHubie.'
      : 'Projekty i pliki są zapisane w tej przeglądarce. Zaloguj się, żeby mieć kosz, historię wersji i dostęp z innych komputerów.';
}

function renderHomeList() {
  const q = $('#homeSearch').value.trim().toLowerCase();
  const sort = $('#homeSort').value;
  const trash = homeTab === 'trash';
  let items = homeCache.filter(p => !q || p.name.toLowerCase().includes(q));
  if (trash) items.sort((a, b) => (b.deleted || 0) - (a.deleted || 0));
  else if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  else if (sort === 'long') items.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else items.sort((a, b) => b.updated - a.updated);
  // zaznaczenie trzyma tylko projekty, które wciąż są na liście
  if (!trash) for (const id of homeSel) if (!homeCache.some(p => p.id === id)) homeSel.delete(id);
  $('#homeSelBar').hidden = trash;
  updateSelBar();
  if (!items.length) {
    $('#homeList').innerHTML = `<div class="home-empty">${trash ? 'Kosz jest pusty.' : q ? 'Nic nie pasuje do wyszukiwania.' : '<strong>Nie masz jeszcze projektów</strong>Wybierz format powyżej, żeby zacząć pierwszy.'}</div>`;
    return;
  }
  $('#homeList').classList.toggle('selecting', !trash && homeSel.size > 0);
  $('#homeList').innerHTML = items.map(p => {
    const cur = p.id === project.id, sel = !trash && homeSel.has(p.id);
    const meta = trash ? `usunięty ${relTime(p.deleted)}` : `${relTime(p.updated)} · ${shortDur(p.duration || 0)} · ${plFiles((p.mediaIds || []).length)}`;
    const acts = trash
      ? `<div class="pc-acts"><button type="button" class="btn small" data-hact="restore" data-id="${p.id}">Przywróć</button><button type="button" class="btn small danger" data-hact="forever" data-id="${p.id}">Usuń na zawsze</button></div>`
      : `<button type="button" class="pc-more icon-btn" data-hact="more" data-id="${p.id}" aria-haspopup="menu" aria-label="Więcej: ${esc(p.name)}" title="Więcej">⋯</button>`;
    const check = trash ? '' : `<label class="pc-check" title="Zaznacz"><input type="checkbox" data-sel="${p.id}"${sel ? ' checked' : ''}><span class="sr-only">Zaznacz projekt ${esc(p.name)}</span></label>`;
    return `<div class="proj-card${cur ? ' current' : ''}${sel ? ' selected' : ''}${trash ? ' in-trash' : ''}" data-card="${p.id}">
      <button type="button" class="pc-open" data-hact="${trash ? 'noop' : 'open'}" data-id="${p.id}" ${trash ? 'tabindex="-1"' : ''} aria-label="Otwórz projekt ${esc(p.name)}">
        <span class="pc-thumb" style="${p.thumb ? `background-image:url('${p.thumb}')` : ''}">${p.thumb ? '' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>'}${cur ? '<span class="pc-badge">otwarty</span>' : ''}${trash ? '' : ghBadge(p)}</span>
        <span class="pc-name">${esc(p.name)}</span>
        <span class="pc-meta">${meta}</span>
      </button>${check}${acts}</div>`;
  }).join('');
}
function updateSelBar() {
  const n = homeSel.size, total = homeCache.length;
  $('#homeSelCount').textContent = n
    ? `Zaznaczono ${plural(n, 'projekt', 'projekty', 'projektów')}`
    : 'Zaznacz projekty, żeby je zapisać na GitHubie, eksportować, powielić albo usunąć';
  const all = $('#homeSelAll');
  all.checked = n > 0 && n === total;
  all.indeterminate = n > 0 && n < total;
  all.disabled = !total;
  $('#homeSelBar').classList.toggle('has-sel', n > 0);
  $('#homeList').classList.toggle('selecting', n > 0);
}
function toggleSel(id, on = !homeSel.has(id)) {
  if (on) homeSel.add(id); else homeSel.delete(id);
  const card = $('#homeList').querySelector(`[data-card="${id}"]`);
  card?.classList.toggle('selected', on);
  const box = card?.querySelector('[data-sel]');
  if (box) box.checked = on;
  updateSelBar();
}

async function openFromHome(id) {
  if (id === project.id) { hideHome(); return; }
  $('#homeList').setAttribute('aria-busy', 'true');
  const ok = await loadProject(id).catch(() => false);
  $('#homeList').removeAttribute('aria-busy');
  if (ok) hideHome(); else toast('Nie udało się otworzyć projektu');
}
async function newFromHome(fmt) {
  const name = await ask('Nazwa nowego projektu', 'Nowy projekt', { ok: 'Utwórz' });
  if (name === null) return;
  await newProject({ w: fmt.w, h: fmt.h, name: name.trim() || 'Nowy projekt' });
  hideHome();
  toast(`Nowy projekt ${fmt.sub.split('·')[1].trim()} — przeciągnij pliki albo kliknij „Importuj”`, 3500);
}

$('#homeNew').addEventListener('click', e => {
  const b = e.target.closest('[data-fmt]');
  if (b) newFromHome(HOME_FORMATS[+b.dataset.fmt]);
});
$('#homeContinue').addEventListener('click', e => openFromHome(e.currentTarget.dataset.id));
$('#homeList').addEventListener('change', e => {
  if (e.target.matches('[data-sel]')) toggleSel(e.target.dataset.sel, e.target.checked);
});
$('#homeList').addEventListener('click', async e => {
  const b = e.target.closest('[data-hact]');
  if (!b) return;
  const id = b.dataset.id, p = homeCache.find(x => x.id === id), act = b.dataset.hact;
  // Ctrl/Shift + klik albo klik w trakcie zaznaczania przełącza zaznaczenie zamiast otwierać
  if (act === 'open' && homeTab === 'list' && (e.ctrlKey || e.metaKey || e.shiftKey || homeSel.size)) { toggleSel(id); return; }
  try {
    if (act === 'open') await openFromHome(id);
    else if (act === 'restore') { await Store.restoreProject(id); toast(`Przywrócono „${p.name}”`); loadHomeList(); }
    else if (act === 'forever') {
      if (!confirm(`Usunąć „${p.name}” na zawsze? Tego nie da się cofnąć.`)) return;
      await Store.deleteForever(id); loadHomeList();
    } else if (act === 'more') {
      const r = b.getBoundingClientRect();
      openMenu(r.right - 230, r.bottom + 4, [
        { label: 'Otwórz', act: () => openFromHome(id) },
        { label: 'Duplikuj', act: () => homeAction('dup', p) },
        { label: 'Zmień nazwę', act: () => homeAction('rename', p) },
        { label: 'Historia wersji', disabled: Store.mode !== 'cloud', act: () => openVersions(p) },
        { label: 'Eksportuj (.zip)', act: () => exportProjects([p]).catch(ex => toast(ex.message, 4500)) },
        { label: 'Zapisz na GitHub', disabled: Store.mode !== 'cloud', act: () => ghPushSelected([p.id]) },
        '-',
        { label: Store.mode === 'cloud' ? 'Przenieś do kosza' : 'Usuń', act: () => homeAction('delete', p) },
      ]);
    }
  } catch (ex) { toast(ex.message); }
});
async function homeAction(act, p) {
  try {
    if (act === 'dup') { await Store.duplicateProject(p.id, p.name + ' (kopia)'); toast('Utworzono kopię projektu'); }
    else if (act === 'rename') {
      const v = await ask('Nowa nazwa projektu', p.name, { ok: 'Zmień nazwę' });
      if (!v?.trim()) return;
      if (p.id === project.id) { project.name = v.trim(); $('#projName').value = project.name; await saveProject(); }
      else await Store.renameProject(p.id, v.trim());
    } else if (act === 'delete') {
      if (Store.mode !== 'cloud' && !confirm(`Usunąć „${p.name}”? Bez konta nie ma kosza — projekt zniknie na zawsze.`)) return;
      if (p.id === project.id) closeOpenProject(); // usuwamy otwarty projekt: edytor zostaje pusty, wracamy do listy
      await Store.trashProject(p.id);
      toast(Store.mode === 'cloud' ? `„${p.name}” jest w koszu — możesz go przywrócić przez 30 dni` : 'Projekt usunięty');
    }
    await showHome(homeTab);
  } catch (ex) { toast(ex.message); }
}
/* ---------- Działania na zaznaczonych projektach ---------- */
function closeOpenProject() {
  clearTimeout(saveTimer); saveTimer = null;
  clearSession();
  state = newState(); project = { id: null, name: 'Nowy projekt' };
  resetHistory(); renderBin(); renderAll();
}
$('#homeSelAll').addEventListener('change', e => {
  homeSel.clear();
  if (e.target.checked) for (const p of homeCache) homeSel.add(p.id);
  renderHomeList();
});
$('#homeSelBar').addEventListener('click', async e => {
  const b = e.target.closest('[data-bulk]');
  if (!b) return;
  const picked = homeCache.filter(p => homeSel.has(p.id));
  const ids = picked.map(p => p.id);
  const act = b.dataset.bulk;
  if (act === 'github') { ghPushSelected(ids); return; }
  if (!ids.length) { toast('Najpierw zaznacz projekty — pole w rogu miniatury', 3500); return; }
  const what = ids.length === 1 ? `„${picked[0].name}”` : plural(ids.length, 'projekt', 'projekty', 'projektów');
  try {
    if (act === 'dup') {
      for (const p of picked) await Store.duplicateProject(p.id, p.name + ' (kopia)');
      toast(ids.length === 1 ? 'Utworzono kopię projektu' : `Utworzono ${plural(ids.length, 'kopię', 'kopie', 'kopii')} projektów`);
      homeSel.clear();
      await loadHomeList();
    } else if (act === 'delete') {
      if (!confirm(Store.mode === 'cloud' ? `Przenieść ${what} do kosza? Przez 30 dni można je przywrócić.` : `Usunąć ${what}? Bez konta nie ma kosza — znikną na zawsze.`)) return;
      if (ids.includes(project.id)) closeOpenProject();
      for (const id of ids) await Store.trashProject(id);
      homeSel.clear();
      toast(Store.mode === 'cloud' ? `Przeniesiono do kosza: ${what}` : `Usunięto: ${what}`);
      await showHome('list');
    } else if (act === 'export') {
      await exportProjects(picked);
    }
  } catch (ex) { toast(ex.message, 4500); }
});

/* ---------- Eksport i import paczek .zip ----------
   Układ jak w repozytorium GitHub: projekty/<nazwa>-<id>/projekt.json, miniatura, media/…
   Import przyjmuje więc i własny eksport, i ZIP pobrany z GitHuba („Code → Download ZIP”). */
const slugify = (s, max = 40) => (String(s).toLowerCase()
  .replace(/[ąćęłńóśźż]/g, ch => 'acelnoszz'['ąćęłńóśźż'.indexOf(ch)])
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')) || 'bez-nazwy';
function fileExt(name, type) {
  const e = (String(name).match(/\.([a-z0-9]{1,8})$/i) || [])[1];
  if (e) return e.toLowerCase();
  const t = (String(type).split('/')[1] || '').split(';')[0];
  return /^[a-z0-9]{1,8}$/.test(t) ? t : 'bin';
}
async function exportProjects(picked) {
  const zip = new ZipWriter();
  let bytes = 0, missing = 0;
  for (const [i, p] of picked.entries()) {
    const got = await Store.getProject(p.id);
    if (!got) continue;
    const { rec, media: metas } = got;
    const dir = `projekty/${slugify(rec.name)}-${rec.id}/`;
    const items = [];
    for (const { meta, hasFile } of metas) {
      toast(`Eksport ${i + 1}/${picked.length}: „${rec.name}” — ${meta.name}`, 60000);
      const blob = await Store.getBlob(meta, hasFile).catch(() => null);
      let file = null;
      if (blob) {
        bytes += blob.size;
        if (bytes > 3.9e9) throw new Error('Paczka przekroczyłaby 4 GB — zaznacz mniej projektów naraz');
        file = `media/${slugify(String(meta.name).replace(/\.[^.]+$/, ''), 50)}-${meta.id}.${fileExt(meta.name, blob.type)}`;
        zip.add(dir + file, new Uint8Array(await blob.arrayBuffer()));
      } else missing++;
      items.push({ id: meta.id, name: meta.name, type: blob?.type || meta.type || '', size: blob?.size || 0, meta, file });
    }
    if (rec.thumb?.startsWith('data:image/')) {
      const tb = await (await fetch(rec.thumb)).blob();
      zip.add(dir + 'miniatura.' + ({ 'image/png': 'png', 'image/webp': 'webp' }[tb.type] || 'jpg'), new Uint8Array(await tb.arrayBuffer()));
    }
    zip.add(dir + 'projekt.json', new TextEncoder().encode(JSON.stringify({
      cloudcut: 1, id: rec.id, name: rec.name, updated: rec.updated, duration: rec.duration || 0, media: items,
      project: typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data,
    }, null, 2)));
  }
  const count = plural(picked.length, 'projekt', 'projekty', 'projektów');
  downloadBlob(zip.finish(), picked.length === 1 ? `${safeName(picked[0].name)}.zip` : `CloudCut — ${count}.zip`);
  toast(`Wyeksportowano ${count} (${fmtMB(bytes)})${missing ? ` · brak ${plFiles(missing)}` : ''}. Wczytasz je przyciskiem „Importuj…”.`, 6000);
}
/* Czytnik ZIP: spis z końca pliku, dane czytane po kawałku (Blob.slice), kompresja deflate przez DecompressionStream */
async function readZip(file) {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
  if (eocd < 0) throw new Error('To nie jest plik ZIP');
  const end = new DataView(tail.buffer, eocd);
  const count = end.getUint16(10, true), cdSize = end.getUint32(12, true), cdOff = end.getUint32(16, true);
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error('Plik ZIP jest za duży (ponad 4 GB) — rozpakuj go i spakuj mniejsze części');
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder(), entries = new Map();
  for (let i = 0, p = 0; i < count && cd.getUint32(p, true) === 0x02014b50; i++) {
    const nlen = cd.getUint16(p + 28, true);
    entries.set(dec.decode(new Uint8Array(cd.buffer, p + 46, nlen)), {
      method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), off: cd.getUint32(p + 42, true),
    });
    p += 46 + nlen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
  }
  return {
    names: [...entries.keys()],
    async blob(name, type = '') {
      const e = entries.get(name);
      if (!e) return null;
      const lh = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
      const start = e.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = file.slice(start, start + e.csize);
      if (e.method === 0) return new Blob([raw], { type });
      if (e.method === 8) return new Blob([await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()], { type });
      throw new Error(`Nieobsługiwana kompresja pliku „${name}” w ZIP`);
    },
  };
}
async function importProjects(file) {
  if (!Store.ready) throw new Error('Zapis projektów nie działa w tym trybie');
  const zip = await readZip(file);
  const pjs = zip.names.filter(n => /(^|\/)projekt\.json$/.test(n));
  if (!pjs.length) throw new Error('W tym pliku nie ma projektów CloudCut (brak projekt.json)');
  let done = 0, missing = 0, lfs = 0;
  for (const [i, pjName] of pjs.entries()) {
    const dir = pjName.slice(0, -'projekt.json'.length);
    let pj;
    try { pj = JSON.parse(await (await zip.blob(pjName)).text()); } catch { continue; }
    if (pj?.cloudcut !== 1 || !pj.project) continue;
    let data = JSON.stringify(pj.project);
    const mediaIds = [];
    for (const m of pj.media || []) {
      const blob = m.file ? await zip.blob(dir + m.file, m.type || '') : null;
      if (!blob) { missing++; continue; }
      // ZIP z GitHuba bez obiektów LFS ma w miejscu dużego pliku tylko krótki wskaźnik
      if (blob.size < 300 && (await blob.text()).startsWith('version https://git-lfs')) { lfs++; continue; }
      toast(`Import ${i + 1}/${pjs.length}: „${pj.name}” — ${m.name}`, 60000);
      const nid = uid('m');
      data = data.split(`"${m.id}"`).join(`"${nid}"`);
      const mm = { ...(m.meta || {}), id: nid, name: m.name, type: m.type || blob.type, blob };
      await Store.putMediaMeta(mediaMeta(mm));
      await Store.putBlob(mm);
      mediaIds.push(nid);
    }
    let thumb = '';
    const tn = zip.names.find(n => n.startsWith(dir + 'miniatura.'));
    if (tn) {
      const ext = tn.split('.').pop();
      const tb = await zip.blob(tn, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      thumb = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(''); fr.readAsDataURL(tb); });
    }
    const name = homeCache.some(p => p.name === pj.name) ? `${pj.name} (import)` : pj.name;
    await Store.putProject({ id: uid('p'), name, updated: Date.now(), data, mediaIds, duration: pj.duration || 0, thumb });
    done++;
  }
  await loadHomeList();
  const notes = [missing && `brak ${plFiles(missing)}`, lfs && `${plFiles(lfs)} z Git LFS nie było w ZIP-ie — pobierz je z GitHuba osobno`].filter(Boolean);
  toast(done ? `Zaimportowano ${plural(done, 'projekt', 'projekty', 'projektów')}${notes.length ? ' · ' + notes.join(' · ') : ''}` : 'Nie udało się wczytać żadnego projektu', 7000);
}
$('#homeImport').addEventListener('click', () => $('#homeImportInput').click());
$('#homeImportInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { await importProjects(f); } catch (ex) { toast(ex.message, 5000); }
});

for (const b of $$('[data-htab]')) b.addEventListener('click', () => showHome(b.dataset.htab));
$('#homeSearch').addEventListener('input', renderHomeList);
$('#homeSort').addEventListener('change', renderHomeList);
$('#homeBack').addEventListener('click', () => { if (project.id) hideHome(); });
$('#homeAccount').addEventListener('click', () => homeNav('account'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isHomeOpen() && project.id && menuEl.hidden && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    e.stopImmediatePropagation(); // ten sam Escape nie może już trafić do skrótów edytora (np. odznaczyć klipów)
    hideHome();
  }
});
$('#brandHome').addEventListener('click', () => showHome());
