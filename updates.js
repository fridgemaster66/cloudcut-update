'use strict';
/* updates.js — aktualizacje programu z repozytorium GitHub: sekcja w Ustawieniach, sprawdzanie przy starcie
   i komunikat „Zaakceptuj i zainstaluj / Przypomnij następnym razem”. Pliki podmienia serwer (server/update.php). */

let updInfo = null;     // ustawienia z serwera: repozytorium, gałąź, zainstalowana wersja, kopia poprzedniej
let updFound = null;    // ostatnio wykryta aktualizacja
let updChecked = false; // sprawdzenie przy starcie robimy raz na uruchomienie programu
const UPD_LATER = 'cloudcut-upd-later'; // sessionStorage: „przypomnij następnym razem” do zamknięcia programu

async function updLoad() {
  if (Store.mode !== 'cloud') { updInfo = null; return null; }
  try { updInfo = await api('GET', 'update'); } catch { updInfo = null; }
  return updInfo;
}
const updDate = s => new Date(s).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Ustawienia ---------- */
let updSnapshot = '';
const updFormValue = () => JSON.stringify([$('#updRepo').value.trim(), $('#updBranch').value.trim(), $('#updAuto').checked]);
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
  $('#updAuto').checked = u.auto ?? true;
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
  updInfo = await api('PUT', 'update', { repo: $('#updRepo').value.trim(), branch: $('#updBranch').value.trim(), auto: $('#updAuto').checked });
  updSnapshot = updFormValue();
  updRenderState();
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
    } else {
      updResult(`✓ Masz najnowszą wersję z ${esc(updFound.repo)}.`, 'ok');
    }
  } catch (ex) { updResult(esc(ex.message), 'err'); }
  btn.disabled = false;
});
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

/* ---------- Sprawdzenie przy starcie i komunikat ---------- */
async function updAutoCheck() {
  if (updChecked || Store.mode !== 'cloud') return;
  updChecked = true;
  await updLoad();
  if (!updInfo?.repo || !updInfo.auto) return;
  try { updFound = await api('POST', 'update/check'); } catch { return; } // brak internetu itp. — nie przeszkadzamy
  if (!updFound.available) return;
  let later = null;
  try { later = sessionStorage.getItem(UPD_LATER); } catch { /* bez pamięci sesji */ }
  if (later === updFound.sha) return;
  updShow(updFound);
}
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
  $('#updDlg').close();
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
