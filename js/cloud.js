'use strict';
/* cloud.js — konto (e-mail + hasło), zapis projektów na serwerze lub w przeglądarce i start aplikacji */

/* =========================================================
   Klient API
   ========================================================= */
async function api(method, path, body) {
  const headers = { 'X-CloudCut': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch('/api/' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
  } catch (err) {
    const e = new Error('Brak połączenia z serwerem');
    e.status = 0;
    throw e;
  }
  let data = null;
  try { data = await r.json(); } catch { /* nie JSON */ }
  if (!r.ok || !data) {
    const e = new Error(data?.error || 'Błąd serwera (' + r.status + ')');
    e.status = data ? r.status : (r.status === 200 ? 502 : r.status);
    throw e;
  }
  return data;
}

function uploadFile(m, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/media/${m.id}/file`);
    x.setRequestHeader('X-CloudCut', '1');
    x.setRequestHeader('Content-Type', m.type || m.blob.type || 'application/octet-stream');
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(Object.assign(new Error('Wysyłanie nie powiodło się'), { status: x.status })));
    x.onerror = () => reject(Object.assign(new Error('Brak połączenia'), { status: 0 }));
    x.send(m.blob);
  });
}

/* =========================================================
   Magazyn: konto na serwerze albo sama przeglądarka.
   Pliki zawsze trafiają też do pamięci przeglądarki — odtwarzanie idzie z dysku, nie z sieci.
   ========================================================= */
const pendingUploads = new Set();
let activeUploads = 0;
const Store = {
  mode: 'local',
  user: null,
  get ready() { return this.mode === 'cloud' || !!DB.db; },
  lastKey() { return 'cloudcut-last-' + (this.mode === 'cloud' ? 'u' + this.user.id : 'local'); },
  uploading() { return activeUploads > 0 || pendingUploads.size > 0; },

  async listProjects() {
    if (this.mode === 'cloud') return (await api('GET', 'projects')).projects;
    return (await DB.all('projects')) || [];
  },
  async getProject(id) {
    if (this.mode === 'cloud') {
      const r = await api('GET', 'projects/' + id);
      return { rec: r.project, media: r.media.map(x => ({ meta: x.meta, hasFile: x.hasFile })) };
    }
    const rec = await DB.get('projects', id);
    if (!rec) return null;
    const metas = [];
    for (const mid of rec.mediaIds || []) { const meta = await DB.get('media', mid); if (meta) metas.push({ meta, hasFile: true }); }
    return { rec, media: metas };
  },
  async getBlob(meta, hasFile) {
    const cached = await DB.get('blobs', meta.id).catch(() => null);
    if (cached?.blob) return cached.blob;
    if (this.mode !== 'cloud' || !hasFile) return null;
    const r = await fetch(`/api/media/${meta.id}/file`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const blob = await r.blob();
    DB.put('blobs', { id: meta.id, blob }).catch(() => {});
    return blob;
  },
  async putProject(rec) {
    if (this.mode === 'cloud') return api('PUT', 'projects/' + rec.id, rec);
    return DB.put('projects', rec);
  },
  async deleteProject(id) {
    if (this.mode === 'cloud') return api('DELETE', 'projects/' + id);
    const rec = await DB.get('projects', id);
    await DB.del('projects', id);
    const others = (await DB.all('projects')) || [];
    const stillUsed = new Set(others.flatMap(p => p.mediaIds || []));
    for (const mid of rec?.mediaIds || []) if (!stillUsed.has(mid)) { await DB.del('media', mid); await DB.del('blobs', mid); }
  },
  async putMediaMeta(meta) {
    if (this.mode === 'cloud') return api('PUT', 'media/' + meta.id, meta);
    return DB.put('media', meta);
  },
  async putBlob(m) {
    await DB.put('blobs', { id: m.id, blob: m.blob }).catch(() => {});
    if (this.mode !== 'cloud') return;
    await this.putMediaMeta(mediaMeta(m));
    activeUploads++;
    try {
      let last = 0;
      await uploadFile(m, p => {
        m.upload = p;
        if (Date.now() - last > 300) { last = Date.now(); renderBin(); }
        setSaveState(`Wysyłanie „${m.name}” — ${Math.round(p * 100)}%`);
      });
      m.upload = null;
      pendingUploads.delete(m.id);
    } catch (err) {
      m.upload = null;
      pendingUploads.add(m.id);
      throw err;
    } finally {
      activeUploads--;
      renderBin();
    }
  },
  async retryUploads() {
    if (this.mode !== 'cloud' || activeUploads) return;
    for (const id of [...pendingUploads]) {
      const m = media.get(id);
      if (!m) { pendingUploads.delete(id); continue; }
      try { await this.putBlob(m); } catch { return; }
    }
  },
  async saveSettings(s) {
    if (this.mode === 'cloud') return api('PUT', 'settings', s).catch(() => {});
  },
  async listTrash() {
    if (this.mode !== 'cloud') return [];
    return (await api('GET', 'projects?trash=1')).projects;
  },
  async trashProject(id) {
    if (this.mode === 'cloud') return api('DELETE', 'projects/' + id);
    return this.deleteProject(id);
  },
  async deleteForever(id) {
    if (this.mode === 'cloud') return api('DELETE', 'projects/' + id + '?forever=1');
    return this.deleteProject(id);
  },
  async restoreProject(id) { return api('POST', `projects/${id}/restore`, {}); },
  async duplicateProject(id, name) {
    const newId = uid('p');
    if (this.mode === 'cloud') { await api('POST', `projects/${id}/duplicate`, { id: newId, name }); return newId; }
    const rec = await DB.get('projects', id);
    await DB.put('projects', { ...rec, id: newId, name, updated: Date.now() });
    return newId;
  },
  async renameProject(id, name) {
    if (this.mode === 'cloud') {
      const r = await api('GET', 'projects/' + id);
      const p = r.project;
      return api('PUT', 'projects/' + id, { id, name, data: p.data, mediaIds: p.mediaIds, duration: p.duration, thumb: p.thumb || '' });
    }
    const rec = await DB.get('projects', id);
    return DB.put('projects', { ...rec, name });
  },
  async versions(id) { return this.mode === 'cloud' ? (await api('GET', `projects/${id}/versions`)).versions : []; },
  async version(id, vid) { return (await api('GET', `projects/${id}/versions/${vid}`)).version; },
  async stats() { return this.mode === 'cloud' ? api('GET', 'stats') : null; },
  // biblioteka „Moje assety”
  async listAssets() {
    if (this.mode === 'cloud') return (await api('GET', 'assets')).assets;
    return JSON.parse(localStorage.getItem('cloudcut-assets') || '[]');
  },
  async putAsset(a, blob) {
    if (this.mode === 'cloud') {
      await api('PUT', 'assets/' + a.id, { kind: a.kind, name: a.name, data: a.data, fav: !!a.fav });
      if (blob) {
        await new Promise((res, rej) => {
          const x = new XMLHttpRequest();
          x.open('PUT', `/api/assets/${a.id}/file`);
          x.setRequestHeader('X-CloudCut', '1');
          x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
          x.onload = () => (x.status < 300 ? res() : rej(new Error('Wysyłanie assetu nie powiodło się')));
          x.onerror = () => rej(new Error('Brak połączenia'));
          x.send(blob);
        });
      }
      return;
    }
    const list = await this.listAssets();
    const i = list.findIndex(x => x.id === a.id);
    const rec = { id: a.id, kind: a.kind, name: a.name, data: a.data, fav: !!a.fav, hasFile: !!blob || !!list[i]?.hasFile, created: Date.now() };
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    localStorage.setItem('cloudcut-assets', JSON.stringify(list));
    if (blob) await DB.put('blobs', { id: 'asset-' + a.id, blob });
  },
  async assetBlob(a) {
    const cached = await DB.get('blobs', 'asset-' + a.id).catch(() => null);
    if (cached?.blob) return cached.blob;
    if (this.mode !== 'cloud') return null;
    const r = await fetch(`/api/assets/${a.id}/file`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const blob = await r.blob();
    DB.put('blobs', { id: 'asset-' + a.id, blob }).catch(() => {});
    return blob;
  },
  async deleteAsset(id) {
    if (this.mode === 'cloud') return api('DELETE', 'assets/' + id);
    const list = (await this.listAssets()).filter(x => x.id !== id);
    localStorage.setItem('cloudcut-assets', JSON.stringify(list));
    DB.del('blobs', 'asset-' + id).catch(() => {});
  },
};

/* =========================================================
   Ekran logowania
   ========================================================= */
const authEl = $('#authScreen');
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  for (const b of $$('[data-auth]')) b.setAttribute('aria-pressed', b.dataset.auth === mode);
  const reg = mode === 'register';
  $('#authTitle').textContent = reg ? 'Załóż konto' : 'Zaloguj się';
  $('#authSub').textContent = reg ? 'Projekty i pliki będą zapisywać się na Twoim koncie.' : 'Twoje projekty i pliki czekają na koncie.';
  $('#authSubmit').textContent = reg ? 'Załóż konto' : 'Zaloguj się';
  $('#authPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('#authPass2Wrap').hidden = !reg;
  $('#authPassHint').hidden = !reg;
  $('#authErr').textContent = '';
}
function showAuth(msg) {
  authEl.hidden = false;
  setAuthMode(authMode);
  if (msg) $('#authErr').textContent = msg;
  setTimeout(() => $('#authEmail').focus(), 0);
}
for (const b of $$('[data-auth]')) b.addEventListener('click', () => { setAuthMode(b.dataset.auth); $('#authEmail').focus(); });
$('#authShow').addEventListener('click', e => {
  const on = $('#authPass').type === 'password';
  $('#authPass').type = on ? 'text' : 'password';
  $('#authPass2').type = on ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', on);
  e.currentTarget.setAttribute('aria-label', on ? 'Ukryj hasło' : 'Pokaż hasło');
});
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const password = $('#authPass').value;
  const err = $('#authErr');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Podaj poprawny adres e-mail.'; $('#authEmail').focus(); return; }
  if (password.length < 8) { err.textContent = 'Hasło musi mieć co najmniej 8 znaków.'; $('#authPass').focus(); return; }
  if (authMode === 'register' && password !== $('#authPass2').value) { err.textContent = 'Hasła nie są takie same.'; $('#authPass2').focus(); return; }
  const btn = $('#authSubmit');
  btn.disabled = true;
  err.textContent = '';
  try {
    const r = await api('POST', authMode === 'register' ? 'register' : 'login', { email, password, remember: $('#authRemember').checked });
    $('#authPass').value = ''; $('#authPass2').value = '';
    authEl.hidden = true;
    try { localStorage.removeItem('cloudcut-mode'); } catch { /* bez zapisu */ }
    await enterCloud(r.user, true);
  } catch (ex) {
    err.textContent = ex.status === 0 ? 'Brak połączenia z serwerem CloudCut.' : ex.message;
  } finally {
    btn.disabled = false;
  }
});
$('#authLocal').addEventListener('click', async () => {
  authEl.hidden = true;
  try { localStorage.setItem('cloudcut-mode', 'local'); } catch { /* bez zapisu */ }
  await enterLocal();
});

/* =========================================================
   Konto
   ========================================================= */
function updateAccountUi() {
  const btn = $('#btnAccount');
  const cloud = Store.mode === 'cloud';
  btn.classList.toggle('local', !cloud);
  btn.classList.toggle('warn', cloud && !!Store.user.initialPassword);
  $('#accAvatar').textContent = cloud ? Store.user.email[0].toUpperCase() : '?';
  $('#accMail').textContent = cloud ? Store.user.email : 'Zaloguj się';
  btn.title = cloud ? `Zalogowano jako ${Store.user.email}` : 'Pracujesz bez konta — kliknij, żeby się zalogować';
  btn.setAttribute('aria-label', btn.title);
}
$('#btnAccount').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const items = Store.mode === 'cloud' ? [
    { label: Store.user.email, disabled: true },
    '-',
    { label: 'Projekty', key: keyLabel('projects'), act: openProjects },
    { label: 'Ustawienia i układ', act: openSettings },
    { label: 'Przenieś projekty z tej przeglądarki na konto', act: () => offerMigration(true) },
    { label: Store.user.initialPassword ? 'Zmień hasło początkowe  ●' : 'Zmień hasło', act: () => openPassword() },
    '-',
    { label: 'Wyloguj się', act: logout },
    { label: 'Usuń konto…', act: deleteAccount },
  ] : [
    { label: 'Zaloguj się lub załóż konto', act: async () => { await flushSave(); showAuth(); } },
    { label: 'Ustawienia i układ', act: openSettings },
  ];
  openMenu(Math.max(8, r.right - 260), r.bottom + 4, items);
});

async function logout() {
  await flushSave();
  if (Store.uploading() && !confirm('Pliki wciąż się wysyłają. Wylogować mimo to? Niewysłane pliki nie trafią na konto.')) return;
  try { await api('POST', 'logout', {}); } catch { /* i tak wylogowujemy lokalnie */ }
  clearSession();
  await clearCloudCache();
  Store.mode = 'local';
  Store.user = null;
  userAssets = [];
  libFolders = [];
  libFolder = null;
  renderAssets();
  state = newState();
  project = { id: null, name: 'Nowy projekt' };
  resetHistory(); renderBin(); renderAll();
  updateAccountUi();
  $('#authEmail').value = '';
  homeEl.hidden = true; document.body.classList.remove('home-open');
  showAuth();
  toast('Wylogowano');
}
async function deleteAccount() {
  const pass = await ask('Hasło', '', {
    title: 'Usunąć konto?', type: 'password', ok: 'Usuń konto', danger: true,
    text: `Usunięcie konta ${Store.user.email} skasuje na zawsze wszystkie projekty i pliki zapisane na koncie. Wpisz hasło, żeby potwierdzić.`,
  });
  if (!pass) return;
  try {
    clearTimeout(saveTimer); saveTimer = null;
    await api('DELETE', 'account', { password: pass });
    clearSession();
    await clearCloudCache();
    Store.mode = 'local'; Store.user = null;
    state = newState(); project = { id: null, name: 'Nowy projekt' };
    resetHistory(); renderBin(); renderAll(); updateAccountUi();
    homeEl.hidden = true; document.body.classList.remove('home-open');
    showAuth();
    toast('Konto zostało usunięte');
  } catch (ex) { toast(ex.message); }
}
/* Po wylogowaniu w przeglądarce zostają tylko pliki projektów pracujących bez konta */
async function clearCloudCache() {
  if (!DB.db) return;
  try {
    const local = (await DB.all('projects')) || [];
    const keep = new Set(local.flatMap(p => p.mediaIds || []));
    const blobs = (await DB.req('blobs', 'readonly', s => s.getAllKeys())) || [];
    for (const id of blobs) if (!keep.has(id)) await DB.del('blobs', id);
  } catch { /* pamięć podręczna nie jest krytyczna */ }
}

/* Przeniesienie projektów zapisanych bez konta */
async function offerMigration(manual = false) {
  if (!DB.db || Store.mode !== 'cloud') return;
  const local = (await DB.all('projects').catch(() => [])) || [];
  const skipKey = 'cloudcut-migrate-skip-' + Store.user.id;
  let skipped = false;
  try { skipped = localStorage.getItem(skipKey) === '1'; } catch { /* brak */ }
  if (!local.length) { if (manual) toast('W tej przeglądarce nie ma projektów zapisanych bez konta'); return; }
  if (skipped && !manual) return;
  if (!confirm(`W tej przeglądarce ${local.length === 1 ? 'jest 1 projekt zapisany' : `są projekty (${local.length}) zapisane`} bez konta.\n\nPrzenieść ${local.length === 1 ? 'go' : 'je'} na konto ${Store.user.email}?`)) {
    try { localStorage.setItem(skipKey, '1'); } catch { /* brak */ }
    return;
  }
  let done = 0;
  for (const p of local) {
    try {
      for (const mid of p.mediaIds || []) {
        const [meta, b] = await Promise.all([DB.get('media', mid), DB.get('blobs', mid)]);
        if (!meta || !b?.blob) continue;
        setSaveState(`Przenoszenie „${p.name}”: ${meta.name}…`);
        await api('PUT', 'media/' + mid, meta);
        await uploadFile({ id: mid, blob: b.blob, type: meta.type }, pr => setSaveState(`Przenoszenie „${p.name}”: ${meta.name} — ${Math.round(pr * 100)}%`));
      }
      await api('PUT', 'projects/' + p.id, { id: p.id, name: p.name, data: p.data, mediaIds: p.mediaIds || [], duration: p.duration || 0, thumb: p.thumb || '' });
      await DB.del('projects', p.id);
      done++;
    } catch (ex) {
      toast(`Nie udało się przenieść „${p.name}”: ${ex.message}`, 5000);
    }
  }
  setSaveState(`Przeniesiono ${done} z ${local.length} projektów`);
  if (done) toast(`Przeniesiono na konto: ${done} ${done === 1 ? 'projekt' : 'projekty'}. Znajdziesz je w „Projekty”.`, 5000);
}

/* =========================================================
   Wejście w tryb pracy
   ========================================================= */
async function openLastProject() {
  let last = null;
  try { last = localStorage.getItem(Store.lastKey()); } catch { /* brak */ }
  if (last && await loadProject(last).catch(() => false)) return;
  const list = await Store.listProjects().catch(() => []);
  const recent = [...list].sort((a, b) => b.updated - a.updated)[0];
  if (recent && await loadProject(recent.id).catch(() => false)) return;
  await newProject();
}
async function enterCloud(user, fresh = false) {
  Store.mode = 'cloud';
  Store.user = user;
  const s = user.settings;
  if (s?.ui) applyUiSettings(s.ui);
  if (s?.keys) { customKeys = s.keys; try { localStorage.setItem('kadr-keys', JSON.stringify(customKeys)); } catch { /* brak */ } rebuildBindings(); }
  updateAccountUi();
  await showHome(); // po zalogowaniu najpierw menu główne z projektami
  loadUserAssets();
  if (fresh) toast(`Zalogowano jako ${user.email}`);
  if (user.initialPassword) setTimeout(() => toast('Logujesz się hasłem początkowym — ustaw własne w menu konta (prawy górny róg).', 6000), fresh ? 3200 : 600);
  offerMigration();
}
async function enterLocal() {
  Store.mode = 'local';
  Store.user = null;
  updateAccountUi();
  if (!DB.db) {
    setSaveState('Zapis niedostępny (tryb prywatny?) — eksportuj film przed zamknięciem', true);
    project = { id: null, name: 'Nowy projekt' };
    resetHistory(); renderAll();
    return;
  }
  await showHome();
  loadUserAssets();
}

async function init() {
  if (IS_DESKTOP) $('#authLocal').textContent = 'Pracuj bez konta — projekty tylko na tym komputerze, bez zapisu na GitHubie';
  $('#zoom').value = ppsToSlider(pps);
  paintRange($('#zoom'));
  applyLayout();
  $('#previewQ').value = String(ui.previewQ);
  renderScale = ui.previewQ;
  applyResolution();
  renderBin();
  renderPresets();
  renderTransitions();
  $('#transAllType').innerHTML = TRANSITIONS.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  renderAssets();
  new ResizeObserver(() => { layoutStage(); drawMeter(true); }).observe($('#stage'));
  try { await DB.open(); } catch { /* bez pamięci przeglądarki */ }
  let me = null, serverOk = true;
  try { me = (await api('GET', 'me')).user; }
  catch (ex) { if (ex.status !== 401) serverOk = false; }
  let localPref = false;
  try { localPref = localStorage.getItem('cloudcut-mode') === 'local'; } catch { /* brak */ }
  if (me) await enterCloud(me);
  else if (!serverOk) { await enterLocal(); toast('Serwer kont jest niedostępny — pracujesz bez konta, w tej przeglądarce', 5000); }
  else if (localPref) await enterLocal();
  else { updateAccountUi(); showAuth(); }
  layoutStage();
  drawMeter(true);
  if (document.fonts) {
    await Promise.all(FONTS.map(f => document.fonts.load(`700 40px "${f}"`).catch(() => {})));
    await ensureProjectFonts();
    drawFrame(); drawRuler(); renderPresets();
  }
}
document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   Projekty (lista jest w menu głównym — home.js), historia wersji, hasło
   ========================================================= */

async function openProjects(tab = 'list') {
  return showHome(tab); // projekty są teraz w menu głównym
}
/* Historia wersji */
const verDlg = $('#verDlg');
async function openVersions(p) {
  if (p.id === project.id) await saveProject();
  let list;
  try { list = await Store.versions(p.id); } catch (ex) { toast(ex.message); return; }
  $('#verTitle').textContent = `Historia wersji — ${p.name}`;
  $('#verList').innerHTML = list.map((v, i) => `<div class="proj-item ver">
      <div class="ver-dot" aria-hidden="true"></div>
      <div><div class="nm">${new Date(v.created * 1000).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'medium' })}${i === 0 ? ' <span class="meta">(najnowsza)</span>' : ''}</div>
      <div class="meta">${esc(v.name)} · ${shortDur(v.duration)}</div></div>
      <div class="acts"><button class="btn small" data-ver="${v.id}" data-pid="${p.id}">Przywróć</button></div></div>`).join('')
    || '<p class="hint">Ten projekt nie ma jeszcze zapisanych wersji — pojawią się po kilku minutach pracy.</p>';

  verDlg.showModal();
}
$('#verList').addEventListener('click', async e => {
  const b = e.target.closest('[data-ver]');
  if (!b) return;
  try {
    const v = await Store.version(b.dataset.pid, b.dataset.ver);
    if (b.dataset.pid !== project.id) await loadProject(b.dataset.pid);
    const missing = (v.mediaIds || []).filter(id => !media.has(id));
    if (missing.length) {
      // pliki tej wersji mogą być spoza obecnego projektu — doczytaj je z konta
      const r = await api('GET', 'projects/' + project.id);
      for (const id of missing) {
        const meta = r.media.find(m => m.meta.id === id)?.meta;
        if (!meta) continue;
        const blob = await Store.getBlob(meta, true);
        if (!blob) continue;
        const m = { ...meta, blob, url: URL.createObjectURL(blob), loading: false };
        if (m.kind === 'image') await loadImage(m).catch(() => {});
        if (m.strip) loadStripImage(m);
        media.set(m.id, m);
      }
    }
    restore(v.data);
    commit();
    verDlg.close();
    toast('Przywrócono wersję z ' + new Date(v.created * 1000).toLocaleString('pl-PL', { timeStyle: 'short', dateStyle: 'short' }) + ' — możesz to cofnąć (Ctrl+Z)');
  } catch (ex) { toast(ex.message); }
});
$('#verClose').addEventListener('click', () => verDlg.close());

/* Zmiana hasła */
const passDlg = $('#passDlg');
function openPassword(info = '') {
  $('#passInfo').textContent = info;
  $('#passErr').textContent = '';
  for (const id of ['#passOld', '#passNew', '#passNew2']) $(id).value = '';
  passDlg.showModal();
  $('#passOld').focus();
}
/* Wspólne dla okna „Zmień hasło” i zakładki Konto w menu głównym: stare hasło + dwa razy nowe */
async function changePassword(old, n1, n2) {
  if (!old) throw new Error('Wpisz obecne hasło.');
  if (n1.length < 8) throw new Error('Nowe hasło musi mieć co najmniej 8 znaków.');
  if (n1 !== n2) throw new Error('Nowe hasła nie są takie same — wpisz je jeszcze raz.');
  if (n1 === old) throw new Error('Nowe hasło musi się różnić od obecnego.');
  await api('POST', 'password', { old, new: n1 });
  Store.user.initialPassword = false;
  updateAccountUi();
  toast('Hasło zostało zmienione');
}
$('#passCancel').addEventListener('click', () => passDlg.close());
$('#passForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await changePassword($('#passOld').value, $('#passNew').value, $('#passNew2').value);
    passDlg.close();
  } catch (ex) { $('#passErr').textContent = ex.message; }
});
