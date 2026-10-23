'use strict';
/* github.js — „Zapisz na GitHub”: połączenie z kontem GitHub w Ustawieniach i wysyłka zaznaczonych projektów z postępem.
   Token zna tylko serwer programu (zaszyfrowany) — tutaj widać najwyżej jego końcówkę. */

let ghInfo = null;   // ustawienia z serwera: repo, gałąź, czy jest token, ostatni zapis, stan wysyłki
let ghPoll = null;

const fmtMB = b => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB');

async function ghLoad() {
  if (Store.mode !== 'cloud') { ghInfo = null; return null; }
  try { ghInfo = await api('GET', 'github'); } catch { ghInfo = null; }
  if (ghInfo?.status?.state === 'running' && !ghPoll) ghStartPolling();
  return ghInfo;
}

/* ---------- Wysyłka zaznaczonych projektów ---------- */
async function ghPushSelected(ids) {
  if (Store.mode !== 'cloud') { toast('Zaloguj się w CloudCut, żeby zapisywać projekty na GitHubie'); return; }
  if (!ids.length) { toast('Zaznacz projekty, które mają trafić na GitHuba — pole w rogu miniatury', 4000); return; }
  await ghLoad();
  if (!ghInfo?.hasToken || !ghInfo?.repo) {
    ghOpenSettings();
    toast('Najpierw połącz CloudCut z GitHubem: wklej token i link do repozytorium', 4500);
    return;
  }
  if (ghInfo.status?.state === 'running') { toast('Wysyłka na GitHuba już trwa'); return; }
  await flushSave();
  if (Store.uploading()) { toast('Poczekaj, aż pliki projektu skończą się zapisywać na dysku — wtedy wyślij'); return; }
  try {
    const r = await api('POST', 'github/push', { projects: ids });
    ghInfo.status = r.status;
    ghRenderProgress();
    ghStartPolling();
  } catch (ex) {
    toast(ex.message, 4500);
    if (ex.status === 428) ghOpenSettings();
  }
}
function ghStartPolling() {
  clearInterval(ghPoll);
  ghPoll = setInterval(async () => {
    let s;
    try { s = (await api('GET', 'github/status')).status; } catch { return; }
    if (!ghInfo) return;
    ghInfo.status = s;
    ghRenderProgress();
    if (s?.state !== 'running') { clearInterval(ghPoll); ghPoll = null; ghFinished(s); }
  }, 700);
}
async function ghFinished(s) {
  if (s?.state === 'done') {
    const r = s.result || {};
    toast(r.unchanged ? 'Na GitHubie wszystko jest już aktualne'
      : `Zapisano na GitHubie: ${plural(r.projects || 0, 'projekt', 'projekty', 'projektów')}, wysłano ${plural(r.files || 0, 'plik', 'pliki', 'plików')} (${fmtMB(r.bytes || 0)})`, 5000);
  } else if (s?.state === 'error') {
    toast('Wysyłka na GitHuba nie udała się — szczegóły pod przyciskiem', 5000);
  }
  await ghLoad();
  if (isHomeOpen()) renderHomeList();
  ghRenderProgress();
}
function ghRenderProgress() {
  const s = ghInfo?.status, running = s?.state === 'running';
  const btn = $('#ghPush');
  btn.classList.toggle('busy', running);
  btn.setAttribute('aria-busy', running ? 'true' : 'false');
  $('#ghPushLabel').textContent = running ? `Wysyłanie… ${s.pct || 0}%` : 'Zapisz na GitHub';
  $('#ghPushBar').style.width = running ? `${s.pct || 0}%` : '0';
  ghRenderLine();
}
function ghRenderLine() {
  const el = $('#ghLine'), s = ghInfo?.status;
  el.className = 'gh-line';
  el.hidden = !ghInfo || homeTab === 'trash';
  if (el.hidden) return;
  if (s?.state === 'running') {
    el.textContent = (s.note || s.step || 'Wysyłanie…') + (s.total ? ` · ${fmtMB(s.bytes || 0)} z ${fmtMB(s.total)}` : '');
    return;
  }
  const repoLink = ghInfo.repoUrl ? ` · <a href="${esc(ghInfo.lastUrl || ghInfo.repoUrl)}" target="_blank" rel="noopener">${esc(ghInfo.repoName)} ↗</a>` : '';
  if (s?.state === 'error') {
    el.classList.add('err');
    el.innerHTML = `Ostatnia wysyłka na GitHuba nie udała się: ${esc(s.error || '')} <button type="button" class="linkbtn" data-gh-settings>Ustawienia GitHuba</button>`;
    return;
  }
  const skipped = s?.state === 'done' && s.result?.skipped?.length ? ` · pominięto: ${esc(s.result.skipped.join(', '))}` : '';
  if (ghInfo.lastPush) { el.innerHTML = `Ostatni zapis na GitHubie: ${relTime(ghInfo.lastPush * 1000)}${repoLink}${skipped}`; return; }
  if (!ghInfo.hasToken) { el.innerHTML = 'GitHub nie jest jeszcze połączony — <button type="button" class="linkbtn" data-gh-settings>połącz go w Ustawieniach</button>.'; return; }
  el.innerHTML = `GitHub połączony${repoLink}. Zaznacz projekty i kliknij „Zapisz na GitHub”.`;
}
/* Znaczek na karcie projektu: jest na GitHubie / ma zmiany od ostatniego zapisu */
function ghBadge(p) {
  const g = ghInfo?.pushed?.[p.id];
  if (!g) return '';
  const stale = (p.updated || 0) > (g.updated || 0);
  const t = stale ? `Na GitHubie jest starsza wersja (zapis ${relTime(g.at * 1000)}) — zmiany czekają na wysłanie` : `Zapisany na GitHubie ${relTime(g.at * 1000)}`;
  return `<span class="pc-gh${stale ? ' stale' : ''}" title="${esc(t)}"><svg class="gh-mark" aria-hidden="true"><use href="#ghMark"/></svg><span class="sr-only">${esc(t)}</span></span>`;
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-gh-settings]')) ghOpenSettings();
});

/* ---------- Ustawienia ---------- */
let ghFilling = null;
async function ghOpenSettings() {
  if (isHomeOpen()) homeNav('settings'); // w menu głównym: zakładka Ustawienia
  else {
    openSettings();
    await new Promise(r => setTimeout(r, 0)); // obserwator otwarcia zdążył uruchomić ghFillSettings
  }
  await ghFilling;
  $('#setGithub').scrollIntoView({ block: 'start' });
  (!ghInfo?.hasToken ? $('#ghToken') : $('#ghRepo')).focus();
}
let ghFormSnapshot = '';
const ghFormValue = () => JSON.stringify([$('#ghRepo').value.trim(), $('#ghBranch').value.trim(), $('#ghToken').value.trim()]);
function ghResult(html, kind = '') {
  const el = $('#ghResult');
  el.className = 'gh-result' + (kind ? ' ' + kind : '');
  el.innerHTML = html;
}
async function ghFillSettings() {
  const cloud = Store.mode === 'cloud';
  $('#ghFields').disabled = !cloud;
  $('#ghIntro').textContent = cloud
    ? 'Projekty zapisują się na tym komputerze. Na GitHuba trafiają te, które zaznaczysz w menu głównym i klikniesz „Zapisz na GitHub”.'
    : 'Zaloguj się w CloudCut, żeby połączyć program z GitHubem — kopia w chmurze działa dla projektów zapisanych na koncie.';
  ghResult('');
  $('#ghCreate').hidden = true;
  if (!cloud) { $('#ghAccount').hidden = true; ghFormSnapshot = ghFormValue(); return; }
  await ghLoad();
  const g = ghInfo || {};
  $('#ghRepo').value = g.repo || 'cloudcat-project001';
  $('#ghBranch').value = g.branch || '';
  $('#ghToken').value = '';
  $('#ghToken').placeholder = g.hasToken ? `zapisany (${g.tokenHint || '…'}) — wklej nowy, żeby zmienić` : 'ghp_…';
  $('#ghForget').hidden = !g.hasToken;
  ghRenderRepoLink(g.repoUrl);
  $('#ghAccount').hidden = !g.login;
  $('#ghAccount').textContent = g.login ? `Połączono z kontem GitHub @${g.login}` : '';
  if (g.hasToken && !g.tokenReadable) ghResult('Zapisanego tokenu nie da się odczytać na tym komputerze — wklej go ponownie.', 'warn');
  ghFormSnapshot = ghFormValue();
}
function ghRenderRepoLink(url) {
  $('#ghOpenRepo').hidden = !url;
  if (url) $('#ghOpenRepo').href = url;
}
async function ghSaveSettings({ silent = false } = {}) {
  const body = { repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim() };
  const tok = $('#ghToken').value.trim();
  if (tok) body.token = tok;
  ghInfo = await api('PUT', 'github', body);
  $('#ghToken').value = '';
  if (!silent) await ghFillSettings();
  ghFormSnapshot = ghFormValue();
  return ghInfo;
}
async function ghCheck() {
  ghResult('Łączenie z GitHubem…');
  const c = await api('POST', 'github/check');
  $('#ghAccount').hidden = false;
  let avatar = '';
  try { const u = new URL(c.avatar); u.searchParams.set('s', '48'); avatar = `<img src="${esc(u.href)}" alt="" width="20" height="20">`; } catch { /* bez awatara */ }
  $('#ghAccount').innerHTML = `${avatar}<span>Połączono z kontem GitHub <strong>@${esc(c.login)}</strong></span>`;
  const r = c.repo;
  $('#ghCreate').hidden = true;
  if (!r) { ghResult('Token działa. Wpisz jeszcze link albo nazwę repozytorium.', 'warn'); return; }
  if (!r.exists) {
    if (r.canCreate) {
      $('#ghCreate').hidden = false;
      $('#ghCreate').textContent = `Utwórz repozytorium ${r.full.split('/')[1]}`;
      ghResult(`Repozytorium <strong>${esc(r.full)}</strong> jeszcze nie istnieje — kliknij „Utwórz repozytorium”, a program założy je jako prywatne.`, 'warn');
    } else {
      ghResult(`Nie widzę repozytorium <strong>${esc(r.full)}</strong>. Sprawdź link albo czy token ma do niego dostęp.`, 'err');
    }
    ghRenderRepoLink(null);
    return;
  }
  ghRenderRepoLink(r.url);
  const notes = [];
  if (r.canPush === false) { ghResult(`Token nie ma prawa zapisu do <strong>${esc(r.full)}</strong>. Utwórz nowy token z zaznaczonym zakresem „repo”.`, 'err'); return; }
  if (!r.private) notes.push('<br>Uwaga: repozytorium jest <strong>publiczne</strong> — każdy zobaczy Twoje filmy. Zmień je na prywatne w Settings repozytorium na GitHubie.');
  if (!c.scopesOk) notes.push('<br>Token może nie mieć zakresu „repo” — jeśli zapis się nie uda, utwórz nowy.');
  ghResult(`✓ Gotowe: projekty będą trafiać do <strong>${esc(r.full)}</strong>${r.private ? ' (prywatne)' : ''}.${notes.join('')}`, notes.length ? 'warn' : 'ok');
}
$('#ghForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#ghSaveBtn');
  btn.disabled = true;
  try {
    await ghSaveSettings();
    if (ghInfo.hasToken) await ghCheck();
    else ghResult('Zapisano. Wklej jeszcze token GitHub, żeby połączyć konto.', 'warn');
  } catch (ex) { ghResult(esc(ex.message), 'err'); }
  btn.disabled = false;
  ghRenderLine();
});
$('#ghCreate').addEventListener('click', async () => {
  const btn = $('#ghCreate');
  btn.disabled = true;
  try {
    const r = await api('POST', 'github/create');
    btn.hidden = true;
    await ghLoad();
    $('#ghRepo').value = ghInfo?.repo || r.full;
    ghFormSnapshot = ghFormValue();
    ghRenderRepoLink(r.url);
    ghResult(`✓ Założono prywatne repozytorium <strong>${esc(r.full)}</strong>. Zaznacz projekty w menu głównym i kliknij „Zapisz na GitHub”.`, 'ok');
  } catch (ex) { ghResult(esc(ex.message), 'err'); }
  btn.disabled = false;
});
$('#ghForget').addEventListener('click', async () => {
  if (!confirm('Odłączyć GitHuba? Token zostanie usunięty z programu. Pliki w repozytorium na GitHubie zostają.')) return;
  try {
    ghInfo = await api('PUT', 'github', { clearToken: true });
    await ghFillSettings();
    ghResult('Odłączono. Token możesz też unieważnić na GitHubie: Settings → Developer settings → Tokens.', 'ok');
    ghRenderLine();
  } catch (ex) { ghResult(esc(ex.message), 'err'); }
});
$('#ghTokenShow').addEventListener('click', e => {
  const show = $('#ghToken').type === 'password';
  $('#ghToken').type = show ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', show);
  e.currentTarget.setAttribute('aria-label', show ? 'Ukryj token' : 'Pokaż token');
});
{
  const dlg = $('#settingsDlg');
  // wypełnij sekcję przy każdym otwarciu Ustawień, a niezapisane zmiany zapisz przy zamknięciu
  new MutationObserver(() => { if (dlg.open) ghFilling = ghFillSettings(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  dlg.addEventListener('close', () => { ghAutoSave(); updAutoSave(); });
}
function ghAutoSave() {
  if (Store.mode !== 'cloud' || ghFormValue() === ghFormSnapshot) return;
  ghSaveSettings({ silent: true }).then(() => { toast('Zapisano ustawienia GitHuba'); ghRenderLine(); }).catch(ex => toast(ex.message, 4500));
}
