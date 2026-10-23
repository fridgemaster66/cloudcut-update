'use strict';
/* updates.js — aktualizacje programu z repozytorium GitHub: sekcja w Ustawieniach, sprawdzanie przy starcie
   i komunikat „Zaakceptuj i zainstaluj / Przypomnij następnym razem”. Pliki podmienia serwer (server/update.php). */

let updInfo = null;     // ustawienia z serwera: repozytorium, gałąź, zainstalowana wersja, kopia poprzedniej
let updFound = null;    // ostatnio wykryta aktualizacja
let updChecked = false; // sprawdzenie przy starcie robimy raz na uruchomienie programu
let updTimer = null;    // tryb „przy każdej zmianie”: odpytywanie repozytorium
const UPD_LATER = 'cloudcut-upd-later'; // sessionStorage: „przypomnij następnym razem” do zamknięcia programu
const UPD_EVERY = 180_000;              // co ile sprawdzać w trybie „przy każdej zmianie”

async function updLoad() {
  if (Store.mode !== 'cloud') { updInfo = null; return null; }
  try { updInfo = await api('GET', 'update'); } catch { updInfo = null; }
  return updInfo;
}
const updDate = s => new Date(s).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Ustawienia ---------- */
let updSnapshot = '';
const updFormValue = () => JSON.stringify([$('#updRepo').value.trim(), $('#updBranch').value.trim(), $('#updMode').value]);
function updResult(html, kind = '') {
  const el = $('#updResult');
  el.className = 'gh-result' + (kind ? ' ' + kind : '');
  el.innerHTML = html;
}
async function updFill() {
  const cloud = Store.mode === 'cloud';
  $('#updFields').disabled = !cloud;
  updResult(cloud ? '' : 'Zaloguj się w CloudCut, żeby ustawić aktualizacje.', cloud ? '' : 'warn');
  if (!cloud) { $('#updState').textContent = ''; return; }
  await updLoad();
  const u = updInfo || {};
  $('#updRepo').value = u.repo || '';
  $('#updBranch').value = u.branch || '';
  $('#updMode').value = u.mode || 'watch';
  updSnapshot = updFormValue();
  updRenderState();
}
function updRenderState() {
  const u = updInfo || {};
  $('#updRollback').hidden = !u.backup;
  $('#updShowFound').hidden = !updFound?.available;
  const parts = [];
  parts.push(u.installed ? `Zainstalowana aktualizacja: „${u.installed.message.split('\n')[0]}” (${new Date(u.installed.at * 1000).toLocaleDateString('pl-PL')}).` : 'Program w wersji z instalacji.');
  if (u.lastCheck) parts.push(`Ostatnio sprawdzono ${relTime(u.lastCheck.at * 1000)} — ${u.lastCheck.changes ? plural(u.lastCheck.changes, 'zmieniony plik', 'zmienione pliki', 'zmienionych plików') : 'bez zmian'}.`);
  if (u.canApply === false) parts.push('Instalować aktualizacje może wersja na komputer (CloudCut.exe).');
  $('#updState').textContent = parts.join(' ');
}
async function updSaveForm() {
  updInfo = await api('PUT', 'update', { repo: $('#updRepo').value.trim(), branch: $('#updBranch').value.trim(), mode: $('#updMode').value });
  updSnapshot = updFormValue();
  updRenderState();
  updWatch();
}
function updAutoSave() {
  if (Store.mode !== 'cloud' || updFormValue() === updSnapshot) return;
  updSaveForm().then(() => toast('Zapisano ustawienia aktualizacji')).catch(ex => toast(ex.message, 4500));
}
$('#updForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await updSaveForm();
    updResult(updInfo.repo ? '✓ Zapisano. Kliknij „Sprawdź teraz”, żeby od razu poszukać aktualizacji.' : 'Zapisano — aktualizacje są wyłączone (brak linku).', 'ok');
  } catch (ex) { updResult(esc(ex.message), 'err'); }
});
$('#updCheckNow').addEventListener('click', async () => {
  const btn = $('#updCheckNow');
  btn.disabled = true;
  updResult('Sprawdzanie repozytorium…');
  try {
    if (updFormValue() !== updSnapshot) await updSaveForm();
    if (!updInfo?.repo) throw new Error('Najpierw wklej link do repozytorium z aktualizacjami.');
    updFound = await api('POST', 'update/check');
    await updLoad();
    updRenderState();
    if (updFound.available) {
      updResult(`Jest aktualizacja: ${plural(updFound.files.length, 'zmieniony plik', 'zmienione pliki', 'zmienionych plików')}.`, 'warn');
      updShow(updFound);
    } else if (updFound.incomplete) {
      updResult(updIncompleteMsg(updFound), 'warn');
    } else if (updFound.ahead) {
      updResult(`Na tym komputerze jest nowsza wersja programu niż w <strong>${esc(updFound.repo)}</strong> (${plural(updFound.files.length, 'nowszy plik', 'nowsze pliki', 'nowszych plików')}) — nic nie instaluję. Wyślij nową wersję do repozytorium, żeby było aktualne.`, 'warn');
    } else {
      updResult(`✓ Masz najnowszą wersję z ${esc(updFound.repo)}.`, 'ok');
    }
  } catch (ex) { updResult(esc(ex.message), 'err'); }
  btn.disabled = false;
});
/* Repozytorium bez pełnego programu — instalacja z niego mieszałaby stary i nowy kod */
function updIncompleteMsg(c) {
  const ex = c.missing[0] || '';
  return c.flat
    ? `W repozytorium <strong>${esc(c.repo)}</strong> pliki leżą bez folderów (np. ${esc(ex.split('/').pop())} zamiast ${esc(ex)}) — tak robi GitHub, gdy wgrywa się pojedyncze pliki. `
      + 'Przeciągnij na stronę GitHuba („Add file → Upload files”) <strong>całą zawartość</strong> rozpakowanego folderu CloudCut, razem z folderami js, server i vendor. Do tego czasu program nie proponuje aktualizacji.'
    : `Repozytorium <strong>${esc(c.repo)}</strong> jest niepełne — brakuje ${plFiles(c.missingCount)} programu (np. ${esc(c.missing.slice(0, 3).join(', '))}). Wgraj cały folder CloudCut. Do tego czasu program nie proponuje aktualizacji.`;
}
$('#updShowFound').addEventListener('click', () => { if (updFound?.available) updShow(updFound); });
$('#updRollback').addEventListener('click', async () => {
  if (!confirm('Przywrócić pliki programu sprzed ostatniej aktualizacji? Projekty i konto zostają bez zmian.')) return;
  try {
    await flushSave();
    const r = await api('POST', 'update/rollback');
    toast(`Przywrócono poprzednią wersję (${plFiles(r.files)}) — uruchamiam ponownie…`, 4000);
    setTimeout(() => location.reload(), 900);
  } catch (ex) { updResult(esc(ex.message), 'err'); }
});
new MutationObserver(() => { if ($('#settingsDlg').open) updFill(); }).observe($('#settingsDlg'), { attributes: true, attributeFilter: ['open'] });

/* ---------- Sprawdzanie przy starcie, przy każdej zmianie i komunikat ---------- */
async function updAutoCheck() {
  if (updChecked || Store.mode !== 'cloud') return;
  updChecked = true;
  await updLoad();
  updWatch();
  if (!updInfo?.repo || updInfo.mode === 'manual') return;
  try { updFound = await api('POST', 'update/check'); } catch { return; } // brak internetu, puste repozytorium — nie przeszkadzamy
  updOffer();
}
/* Tryb „przy każdej zmianie”: co UPD_EVERY lekkie zapytanie o ostatni commit (serwer porównuje pliki tylko po zmianie) */
function updWatch() {
  clearTimeout(updTimer);
  updTimer = null;
  if (Store.mode !== 'cloud' || !updInfo?.repo || updInfo.mode !== 'watch') return;
  updTimer = setTimeout(async function tick() {
    if (Store.mode !== 'cloud' || updInfo?.mode !== 'watch') return;
    let delay = UPD_EVERY;
    try {
      updFound = await api('POST', 'update/poll');
      updOffer();
    } catch { delay = UPD_EVERY * 3; } // błąd lub puste repozytorium — rzadziej, żeby nie zużywać limitu GitHuba
    updTimer = setTimeout(tick, delay);
  }, UPD_EVERY);
}
/* Pokazuje znalezioną aktualizację, chyba że użytkownik odłożył właśnie tę wersję („Przypomnij następnym razem”) */
function updOffer() {
  updSetDot();
  if (isHomeOpen() && homeView === 'updates') updpLoad();
  if (!updFound?.available || $('#updDlg').open) return;
  let later = null;
  try { later = sessionStorage.getItem(UPD_LATER); } catch { /* bez pamięci sesji */ }
  if (later === updFound.sha) return;
  // w menu głównym okno; w edytorze dymek w rogu, żeby nie przerywać montażu
  if (isHomeOpen() || !project.id) updShow(updFound);
  else {
    $('#updBannerText').textContent = `Dostępna aktualizacja CloudCut: ${(updFound.message || '').split('\n')[0] || plFiles(updFound.files.length)}`;
    $('#updBanner').hidden = false;
  }
}
$('#updBannerShow').addEventListener('click', () => { $('#updBanner').hidden = true; if (updFound?.available) updShow(updFound); });
$('#updBannerLater').addEventListener('click', () => { $('#updBanner').hidden = true; updLater(); });
function updShow(c) {
  const dlg = $('#updDlg');
  const [title, ...rest] = (c.message || 'Zmiany w programie').split('\n');
  $('#updDlgMsg').innerHTML = `<strong>${esc(title)}</strong>${rest.join('\n').trim() ? `<br><span>${esc(rest.join('\n').trim())}</span>` : ''}`;
  $('#updDlgMeta').innerHTML = `${esc(c.repo)} · gałąź ${esc(c.branch)}${c.date ? ' · ' + esc(updDate(c.date)) : ''} · <a href="${esc(c.url)}" target="_blank" rel="noopener">zobacz na GitHubie ↗</a>`;
  const shown = c.files.slice(0, 10);
  $('#updDlgFiles').innerHTML = shown.map(f => `<li><code>${esc(f.path)}</code>${f.new ? ' <span class="upd-new">nowy</span>' : ''}</li>`).join('')
    + (c.files.length > shown.length ? `<li class="hint">i jeszcze ${plFiles(c.files.length - shown.length)}</li>` : '');
  $('#updAccept').disabled = !c.canApply;
  $('#updDlgNote').textContent = c.canApply
    ? 'Przed instalacją program odłoży kopię obecnych plików — w Ustawieniach możesz do niej wrócić. Projekty i konto zostają bez zmian.'
    : 'Ta wersja programu nie instaluje aktualizacji sama — zrobi to CloudCut.exe.';
  if (!dlg.open) dlg.showModal();
  $('#updLater').focus();
}
function updLater() {
  try { sessionStorage.setItem(UPD_LATER, updFound?.sha || ''); } catch { /* bez pamięci sesji */ }
  if ($('#updDlg').open) $('#updDlg').close();
  toast('Przypomnę o aktualizacji przy następnym uruchomieniu programu', 3500);
}
$('#updLater').addEventListener('click', updLater);
$('#updDlg').addEventListener('cancel', e => { e.preventDefault(); updLater(); });
$('#updAccept').addEventListener('click', async () => {
  const btn = $('#updAccept');
  btn.disabled = true;
  $('#updLater').disabled = true;
  btn.textContent = 'Instalowanie…';
  try {
    await flushSave();
    const r = await api('POST', 'update/apply');
    try { sessionStorage.removeItem(UPD_LATER); } catch { /* bez pamięci sesji */ }
    toast(`Zainstalowano aktualizację (${plFiles(r.files)}) — uruchamiam ponownie…`, 4000);
    setTimeout(() => location.reload(), 900);
  } catch (ex) {
    toast(ex.message, 6000);
    btn.disabled = false;
    $('#updLater').disabled = false;
    btn.textContent = 'Zaakceptuj i zainstaluj';
  }
});

/* ---------- Zakładka „Aktualizacje” w menu głównym ---------- */
let updHist = null;
// data i godzina co do minuty, np. „23.10.2026, 16:05”
const fmtDT = v => new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const UPD_MODE_NAMES = { watch: 'przy każdej zmianie w repozytorium (co 3 minuty)', start: 'przy każdym uruchomieniu programu', manual: 'tylko ręcznie' };
function updSetDot() { $('#hnUpdatesDot').hidden = !updFound?.available; }
async function updpLoad() {
  if (Store.mode !== 'cloud') {
    updHist = null;
    $('#updpStatus').className = 'upd-status';
    $('#updpStatus').textContent = 'Zaloguj się, żeby sprawdzać i instalować aktualizacje.';
    $('#updpCommits').innerHTML = $('#updpLog').innerHTML = '';
    return;
  }
  if (!updHist) $('#updpStatus').textContent = 'Wczytywanie historii aktualizacji…';
  try { updHist = await api('GET', 'update/history'); } catch (ex) { updHist = { commits: [], log: [], commitsError: ex.message }; }
  if (updHist.check) { updFound = updHist.check; updSetDot(); }
  updpRender();
}
function updpRender() {
  const h = updHist || {}, c = h.check;
  const st = $('#updpStatus');
  let kind = '', html = '';
  if (h.checkError) { kind = 'err'; html = esc(h.checkError); }
  else if (!c) { html = 'Program jeszcze nie sprawdzał aktualizacji.'; }
  else if (c.available) {
    kind = 'warn';
    html = `<strong>Dostępna aktualizacja:</strong> „${esc((c.message || '').split('\n')[0])}”${c.date ? ` z ${fmtDT(c.date)}` : ''} · ${plFiles(c.files.length)}
      <button type="button" class="btn primary small" id="updpInstall"${c.canApply ? '' : ' disabled'}>Zainstaluj…</button>`;
  } else if (c.incomplete) { kind = 'warn'; html = updIncompleteMsg(c); }
  else if (c.ahead) { kind = 'warn'; html = `Na tym komputerze jest nowsza wersja programu niż w <strong>${esc(c.repo)}</strong> (${plural(c.files.length, 'nowszy plik', 'nowsze pliki', 'nowszych plików')}) — nic nie trzeba instalować. Repozytorium czeka na wysłanie nowej wersji.`; }
  else { kind = 'ok'; html = `✓ Masz najnowszą wersję programu z <strong>${esc(c.repo)}</strong>.`; }
  const lc = h.lastCheck?.at ? `Ostatnio sprawdzono: ${fmtDT(h.lastCheck.at * 1000)}` : '';
  const inst = h.installed ? `Zainstalowana aktualizacja: „${esc(h.installed.message.split('\n')[0])}” (${fmtDT(h.installed.at * 1000)})` : 'Program w wersji z instalacji';
  st.className = 'upd-status' + (kind ? ' ' + kind : '');
  st.innerHTML = `<div class="upd-status-main">${html}</div>
    <div class="upd-status-meta">${[inst, lc, `sprawdzanie ${UPD_MODE_NAMES[h.mode] || ''}`].filter(Boolean).join(' · ')}
      ${h.backup ? '<button type="button" class="linkbtn" id="updpRollback">Przywróć poprzednią wersję</button>' : ''}</div>`;
  $('#updpSub').innerHTML = h.repo ? `Zmiany w <a href="${esc(h.repoUrl)}" target="_blank" rel="noopener">${esc(h.repo)} ↗</a> (gałąź ${esc(h.branch)}) i to, co zainstalowano na tym komputerze.` : 'Ostatnie zmiany programu i to, co zainstalowano na tym komputerze.';
  // historia repozytorium
  const commits = h.commits || [];
  $('#updpCommits').innerHTML = h.commitsError ? `<li class="upd-empty err">${esc(h.commitsError)}</li>`
    : !commits.length ? '<li class="upd-empty">Repozytorium z aktualizacjami jest puste.</li>'
    : commits.map((cm, i) => {
      const badges = [];
      if (h.installed?.sha === cm.sha) badges.push('<span class="upd-badge inst">zainstalowana</span>');
      if (c?.available && c.sha === cm.sha) badges.push('<span class="upd-badge new">dostępna</span>');
      if (i === 0 && c && c.sha === cm.sha && !c.available && !c.ahead && !c.incomplete) badges.push('<span class="upd-badge inst">taka jak na komputerze</span>');
      if (i === 0 && c?.ahead && c.sha === cm.sha) badges.push('<span class="upd-badge old">starsza niż na komputerze</span>');
      return `<li class="upd-item"><time datetime="${esc(cm.date)}">${esc(fmtDT(cm.date))}</time>
        <div class="upd-body"><strong>${esc(cm.title)}</strong> ${badges.join('')}
          ${cm.body ? `<p class="upd-desc">${esc(cm.body.length > 400 ? cm.body.slice(0, 400) + '…' : cm.body)}</p>` : ''}
          <span class="upd-meta">${cm.author ? esc(cm.author) + ' · ' : ''}<a href="${esc(cm.url)}" target="_blank" rel="noopener">${esc(cm.sha.slice(0, 7))} ↗</a></span></div></li>`;
    }).join('');
  // dziennik tego komputera
  const log = h.log || [];
  $('#updpLog').innerHTML = log.length ? log.map(e => `<li class="upd-item"><time datetime="${new Date(e.at * 1000).toISOString()}">${esc(fmtDT(e.at * 1000))}</time>
      <div class="upd-body"><strong>${e.type === 'rollback' ? 'Przywrócono poprzednią wersję' : 'Zainstalowano aktualizację'}</strong>
        ${e.message ? `<p class="upd-desc">${e.type === 'rollback' ? 'Cofnięto: ' : ''}„${esc(e.message.split('\n')[0])}”</p>` : ''}
        <span class="upd-meta">${plFiles(e.count || (e.files || []).length)}${e.files?.length ? ': ' + esc(e.files.slice(0, 6).join(', ')) + (e.files.length > 6 ? '…' : '') : ''}</span></div></li>`).join('')
    : '<li class="upd-empty">Na tym komputerze nie instalowano jeszcze aktualizacji.</li>';
}
$('#updpStatus').addEventListener('click', async e => {
  if (e.target.closest('#updpInstall') && updFound?.available) updShow(updFound);
  if (e.target.closest('#updpRollback')) $('#updRollback').click(); // ten sam przycisk co w Ustawieniach (pyta o potwierdzenie)
});
$('#updpCheck').addEventListener('click', async () => {
  const btn = $('#updpCheck');
  btn.disabled = true;
  $('#updpStatus').className = 'upd-status';
  $('#updpStatus').textContent = 'Sprawdzanie repozytorium…';
  try {
    updFound = await api('POST', 'update/check');
    updSetDot();
  } catch (ex) { toast(ex.message, 5000); }
  await updpLoad();
  btn.disabled = false;
  if (updFound?.available) updShow(updFound);
});
$('#updpSettings').addEventListener('click', () => {
  homeNav('settings');
  setTimeout(() => $('#setUpdates').scrollIntoView({ block: 'start' }), 50);
});
