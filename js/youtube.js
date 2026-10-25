'use strict';
/* youtube.js — połączenie z YouTube w Ustawieniach i „Wyślij na YouTube” w oknie Eksportu:
   tytuł, opis, tagi, kategoria, miniatura, widoczność (publiczny / niepubliczny / prywatny / zaplanowany),
   „dla dzieci” i powiadomienie subskrybentów. Film idzie prosto z okna programu do Google (wysyłka wznawialna). */

let ytInfo = null, ytPending = null, ytWatch = 0;
const YT_CATS = [['22', 'Ludzie i blogi'], ['1', 'Film i animacja'], ['2', 'Motoryzacja'], ['10', 'Muzyka'], ['15', 'Zwierzęta'], ['17', 'Sport'],
  ['19', 'Podróże i wydarzenia'], ['20', 'Gry'], ['23', 'Komedia'], ['24', 'Rozrywka'], ['25', 'Wiadomości i polityka'], ['26', 'Poradniki i styl'],
  ['27', 'Edukacja'], ['28', 'Nauka i technika'], ['29', 'Organizacje non-profit']];
const YT_PRIV = [['public', 'Publiczny', 'każdy może znaleźć i obejrzeć'], ['unlisted', 'Niepubliczny', 'tylko osoby z linkiem'], ['private', 'Prywatny', 'tylko Ty'], ['schedule', 'Zaplanowany', 'stanie się publiczny o wybranej godzinie']];

async function ytLoad() {
  if (Store.mode !== 'cloud') { ytInfo = null; return null; }
  try { ytInfo = await api('GET', 'youtube'); } catch { ytInfo = null; }
  return ytInfo;
}
function ytResult(msg, kind = '') {
  const el = $('#ytResult');
  el.className = 'gh-result' + (kind ? ' ' + kind : '');
  el.textContent = msg;
}
async function ytFillSettings() {
  const box = $('#setYoutube');
  if (!box) return;
  if (Store.mode !== 'cloud') {
    $('#ytFields').disabled = true;
    ytResult('YouTube działa na koncie CloudCut — zaloguj się.');
    return;
  }
  $('#ytFields').disabled = false;
  await ytLoad();
  const i = ytInfo || {};
  $('#ytClientId').value = i.clientId || '';
  $('#ytClientId').placeholder = 'np. 1234567890-abc….apps.googleusercontent.com';
  $('#ytSecret').value = '';
  $('#ytSecret').placeholder = i.configured ? 'zapisany — wpisz nowy, żeby zmienić' : 'GOCSPX-…';
  $('#ytRedirect').textContent = i.redirectUri || '';
  const acc = $('#ytAccount');
  acc.hidden = !i.connected;
  if (i.connected) {
    const ch = i.channel || {};
    acc.innerHTML = `<span class="yt-ava" aria-hidden="true">▶</span>${ch.thumb ? `<img src="${esc(ch.thumb)}" alt="" width="36" height="36" hidden>` : ''}
      <div><strong>${esc(ch.title || 'Kanał YouTube')}</strong><span>Połączono — w oknie Eksportu jest „Wyślij na YouTube”.</span></div>`;
    // avatar kanału zamiast znaczka dopiero, gdy się wczyta (bez pustej ramki przy braku sieci)
    const img = acc.querySelector('img');
    if (img) img.onload = () => { img.hidden = false; acc.querySelector('.yt-ava')?.remove(); };
  }
  $('#ytConnect').hidden = !i.configured;
  $('#ytConnect').textContent = i.connected ? 'Połącz ponownie' : 'Połącz z YouTube';
  $('#ytDisconnect').hidden = !i.connected;
  if (!$('#ytResult').textContent) ytResult(i.connected ? '' : i.configured ? 'Klucz zapisany — kliknij „Połącz z YouTube” i zaloguj się w przeglądarce.' : '');
}
$('#ytForm').addEventListener('submit', async e => {
  e.preventDefault();
  const clientId = $('#ytClientId').value.trim(), clientSecret = $('#ytSecret').value.trim();
  if (clientId === (ytInfo?.clientId || '') && ytInfo?.configured && !clientSecret) { ytResult('Nic się nie zmieniło.'); return; }
  try {
    ytInfo = await api('PUT', 'youtube', { clientId, clientSecret });
    ytResult('Zapisano. Teraz kliknij „Połącz z YouTube”.', 'ok');
  } catch (ex) { ytResult(ex.message, 'err'); return; }
  await ytFillSettings();
});
$('#ytSecretShow').addEventListener('click', e => {
  const inp = $('#ytSecret'), on = inp.type === 'password';
  inp.type = on ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', on);
});
$('#ytConnect').addEventListener('click', async () => {
  try {
    const { url } = await api('POST', 'youtube/connect');
    window.open(url, '_blank'); // przeglądarka systemowa — Google nie pozwala logować się w oknach programów
    ytResult('Zaloguj się w przeglądarce i zezwól CloudCut na wysyłanie filmów. Ta strona sama zauważy połączenie…');
    clearInterval(ytWatch);
    const t0 = Date.now(), was = ytInfo?.channel?.id || null, wasAt = !!ytInfo?.connected;
    ytWatch = setInterval(async () => {
      const i = await ytLoad();
      if (i?.connected && (!wasAt || i.channel?.id !== was || Date.now() - t0 > 4000)) {
        clearInterval(ytWatch);
        ytResult(`Połączono z kanałem „${i.channel?.title || 'YouTube'}”.`, 'ok');
        ytFillSettings();
      } else if (Date.now() - t0 > 5 * 60_000) { clearInterval(ytWatch); ytResult('Nie widzę połączenia — spróbuj „Połącz z YouTube” jeszcze raz.', 'err'); }
    }, 2000);
  } catch (ex) { ytResult(ex.message, 'err'); }
});
$('#ytDisconnect').addEventListener('click', async () => {
  if (!confirm('Odłączyć YouTube? CloudCut przestanie mieć dostęp do kanału (filmy na YouTube zostają).')) return;
  try { ytInfo = await api('POST', 'youtube/disconnect'); ytResult('Odłączono YouTube.'); } catch (ex) { ytResult(ex.message, 'err'); }
  ytFillSettings();
});
// sekcja odświeża się przy każdym otwarciu Ustawień (okno albo zakładka w menu głównym)
{
  const watch = (el, attr) => el && new MutationObserver(() => { if (attr === 'open' ? el.open : !el.hidden) ytFillSettings(); }).observe(el, { attributes: true, attributeFilter: [attr] });
  watch($('#settingsDlg'), 'open');
  watch($('#hpSettings'), 'hidden');
}

/* ---------- Okno „Wyślij na YouTube” ---------- */
let ytDlg = null, ytThumb = null;
function ytPrefs() { try { return JSON.parse(localStorage.getItem('cloudcut-yt') || '{}'); } catch { return {}; } }
function buildYtDialog() {
  ytDlg = document.createElement('dialog');
  ytDlg.className = 'dlg wide yt-dlg';
  ytDlg.setAttribute('aria-labelledby', 'ytdTitle');
  ytDlg.innerHTML = `<form id="ytdForm" novalidate>
    <h2 id="ytdTitle"><svg class="yt-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.4-1.6.5-3.2.5-4.8s-.1-3.2-.5-4.8z"/><path class="yt-play" d="m9.75 15.02 5.75-3.02-5.75-3.02z"/></svg> Wyślij na YouTube</h2>
    <p class="hint" id="ytdChannel"></p>
    <div class="yt-cols">
      <div>
        <div class="field"><div class="lbl"><label for="ytdName">Tytuł</label><span class="lbl-r" id="ytdNameN">0/100</span></div><input type="text" id="ytdName" maxlength="100" required></div>
        <div class="field"><div class="lbl"><label for="ytdDesc">Opis</label><span class="lbl-r" id="ytdDescN">0/5000</span></div><textarea id="ytdDesc" rows="7" maxlength="5000"></textarea>
          <button type="button" class="btn small" id="ytdChapters">Dodaj rozdziały ze znaczników</button></div>
        <div class="field"><label for="ytdTags">Tagi <span class="opt">(po przecinku)</span></label><input type="text" id="ytdTags" placeholder="montaż, poradnik, vlog"></div>
        <div class="field"><label for="ytdCat">Kategoria</label><select id="ytdCat">${YT_CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      </div>
      <div>
        <fieldset class="yt-set"><legend>Miniatura</legend>
          <div class="yt-thumb"><img id="ytdThumbImg" alt="Podgląd miniatury" hidden><span id="ytdThumbNone">YouTube wybierze klatkę sam</span></div>
          <div class="yt-thumb-btns">
            <button type="button" class="btn small" id="ytdThumbFrame" title="Ustaw głowicę na ładnej klatce przed otwarciem tego okna">Bieżąca klatka</button>
            <button type="button" class="btn small" id="ytdThumbFile">Z pliku…</button>
            <button type="button" class="btn small" id="ytdThumbAuto">Automatyczna</button>
          </div>
          <input type="file" id="ytdThumbInput" accept="image/jpeg,image/png" hidden>
        </fieldset>
        <fieldset class="yt-set"><legend>Widoczność</legend>
          ${YT_PRIV.map(([v, l, d]) => `<label class="radio"><input type="radio" name="ytdPriv" value="${v}"> <span><b>${l}</b> — ${d}</span></label>`).join('')}
          <input type="datetime-local" id="ytdWhen" aria-label="Data i godzina publikacji" hidden>
        </fieldset>
        <fieldset class="yt-set"><legend>Czy to film dla dzieci? <span class="req">(wymagane)</span></legend>
          <label class="radio"><input type="radio" name="ytdKids" value="yes"> <span>Tak, jest przeznaczony dla dzieci</span></label>
          <label class="radio"><input type="radio" name="ytdKids" value="no"> <span>Nie, nie jest przeznaczony dla dzieci</span></label>
        </fieldset>
        <label class="check"><input type="checkbox" id="ytdNotify" checked> Powiadom subskrybentów</label>
        <label class="check"><input type="checkbox" id="ytdSave"> Zapisz też plik na dysku</label>
      </div>
    </div>
    <p class="hint yt-note">Film zapisze się jako MP4. Uwaga: Google publikuje filmy z projektów API bez audytu YouTube jako <b>prywatne</b> — wtedy widoczność zmienisz w YouTube Studio.</p>
    <p class="gh-result err" id="ytdErr" role="alert"></p>
    <div class="dlg-actions"><button type="button" class="btn" id="ytdCancel">Anuluj</button><button type="submit" class="btn primary" id="ytdGo">Eksportuj i wyślij</button></div>
  </form>`;
  document.body.appendChild(ytDlg);
  const count = (inp, out, max) => { const f = () => { $(out).textContent = `${$(inp).value.length}/${max}`; }; $(inp).addEventListener('input', f); return f; };
  ytDlg._counts = [count('#ytdName', '#ytdNameN', 100), count('#ytdDesc', '#ytdDescN', 5000)];
  $('#ytdCancel').addEventListener('click', () => ytDlg.close());
  $('#ytdChapters').addEventListener('click', () => {
    const { text, warn } = chaptersText();
    const d = $('#ytdDesc');
    d.value = (d.value.trim() ? d.value.trim() + '\n\n' : '') + text;
    ytDlg._counts.forEach(f => f());
    if (warn.length) toast(warn[0], 6000);
  });
  ytDlg.addEventListener('change', e => { if (e.target.name === 'ytdPriv') $('#ytdWhen').hidden = e.target.value !== 'schedule'; });
  $('#ytdThumbFrame').addEventListener('click', () => ytThumbFromFrame());
  $('#ytdThumbFile').addEventListener('click', () => $('#ytdThumbInput').click());
  $('#ytdThumbAuto').addEventListener('click', () => ytSetThumb(null));
  $('#ytdThumbInput').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1048576) { toast('Miniatura może mieć najwyżej 2 MB (wymóg YouTube)'); return; }
    ytSetThumb(f);
  });
  $('#ytdForm').addEventListener('submit', e => { e.preventDefault(); ytSubmit(); });
}
function ytSetThumb(blob) {
  ytThumb = blob;
  const img = $('#ytdThumbImg');
  if (img.src) URL.revokeObjectURL(img.src);
  img.hidden = !blob;
  $('#ytdThumbNone').hidden = !!blob;
  if (blob) img.src = URL.createObjectURL(blob);
  else img.removeAttribute('src');
}
/* Miniatura z bieżącej klatki podglądu: 1280×720 (albo pion), JPEG do 2 MB */
async function ytThumbFromFrame() {
  drawFrame();
  const k = Math.min(1, 1280 / Math.max(canvas.width, canvas.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(canvas.width * k); cv.height = Math.round(canvas.height * k);
  cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height);
  let q = 0.92, blob;
  do { blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q)); q -= 0.12; } while (blob.size > 2 * 1048576 && q > 0.3);
  ytSetThumb(blob);
}
async function openYouTubeUpload() {
  if (Store.mode !== 'cloud') { toast('Wysyłanie na YouTube działa na koncie CloudCut — zaloguj się'); return; }
  await ytLoad();
  if (!ytInfo?.connected) {
    toast('Najpierw połącz YouTube w Ustawieniach (sekcja „YouTube”)', 5000);
    expDlg.close();
    openSettings();
    $('#setYoutube')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (!ytDlg) buildYtDialog();
  const p = ytPrefs();
  $('#ytdChannel').textContent = `Kanał: ${ytInfo.channel?.title || 'połączony'}`;
  $('#ytdName').value = ($('#projName').value || 'Mój film').slice(0, 100);
  $('#ytdDesc').value = '';
  $('#ytdTags').value = p.tags || '';
  $('#ytdCat').value = p.cat || '22';
  for (const r of $$('[name="ytdPriv"]')) r.checked = r.value === (p.priv || 'private');
  for (const r of $$('[name="ytdKids"]')) r.checked = p.kids ? r.value === p.kids : false;
  $('#ytdWhen').hidden = (p.priv || 'private') !== 'schedule';
  const tomorrow = new Date(Date.now() + 86400_000); tomorrow.setMinutes(0, 0, 0);
  $('#ytdWhen').value = new Date(tomorrow - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('#ytdNotify').checked = p.notify !== false;
  $('#ytdSave').checked = !!p.save;
  $('#ytdErr').textContent = '';
  ytDlg._counts.forEach(f => f());
  await ytThumbFromFrame();
  ytDlg.showModal();
  $('#ytdName').focus();
}
function ytSubmit() {
  const err = m => { $('#ytdErr').textContent = m; return false; };
  const title = $('#ytdName').value.trim();
  if (!title) return err('Wpisz tytuł filmu.');
  if (/[<>]/.test(title + $('#ytdDesc').value)) return err('YouTube nie przyjmuje znaków < i > w tytule ani opisie.');
  const priv = $('[name="ytdPriv"]:checked')?.value || 'private';
  const kids = $('[name="ytdKids"]:checked')?.value;
  if (!kids) return err('Zaznacz, czy film jest przeznaczony dla dzieci — YouTube tego wymaga.');
  let publishAt = null;
  if (priv === 'schedule') {
    const d = new Date($('#ytdWhen').value);
    if (!(d > new Date(Date.now() + 15 * 60_000))) return err('Wybierz datę publikacji co najmniej 15 minut od teraz.');
    publishAt = d.toISOString();
  }
  const tags = $('#ytdTags').value.split(',').map(t => t.trim().replace(/[<>"]/g, '')).filter(Boolean);
  if (tags.join(',').length > 500) return err('Tagi razem mogą mieć najwyżej 500 znaków.');
  ytPending = {
    title, description: $('#ytdDesc').value, tags, categoryId: $('#ytdCat').value, privacy: priv === 'schedule' ? 'private' : priv, publishAt,
    kids: kids === 'yes', notify: $('#ytdNotify').checked, save: $('#ytdSave').checked, thumb: ytThumb,
  };
  try { localStorage.setItem('cloudcut-yt', JSON.stringify({ tags: $('#ytdTags').value, cat: ytPending.categoryId, priv, kids, notify: ytPending.notify, save: ytPending.save })); } catch { /* bez zapisu */ }
  ytDlg.close();
  // eksport do MP4 (H.264) — film trafia do ytUpload zamiast do folderu Pobrane
  const fmt = $('#expFmt');
  if ([...fmt.options].some(o => o.value === 'mp4' && !o.disabled)) { fmt.value = 'mp4'; fmt.dispatchEvent(new Event('change', { bubbles: true })); }
  $('#expStart').click();
}

/* ---------- Wysyłka ---------- */
function ytErrText(status, raw) {
  let j = null;
  try { j = JSON.parse(raw); } catch { /* nie JSON */ }
  const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
  const map = {
    quotaExceeded: 'Wyczerpany dzienny limit API YouTube (ok. 6 filmów na dobę na projekt Google) — spróbuj jutro.',
    uploadLimitExceeded: 'YouTube nie przyjmuje dziś więcej filmów z tego kanału — spróbuj później.',
    youtubeSignupRequired: 'To konto Google nie ma kanału YouTube — załóż go na youtube.com i połącz ponownie.',
    forbidden: 'YouTube odmówił — sprawdź, czy połączone konto ma dostęp do kanału.',
    invalidTitle: 'YouTube nie przyjął tytułu.', invalidDescription: 'YouTube nie przyjął opisu.', invalidTags: 'YouTube nie przyjął tagów.',
    invalidPublishAt: 'Nieprawidłowa data publikacji.', authError: 'Połączenie z YouTube wygasło — połącz ponownie w Ustawieniach.',
  };
  if (status === 401) return map.authError;
  return map[reason] || `YouTube zwrócił błąd ${status}${j?.error?.message ? ': ' + j.error.message : ''}`;
}
async function ytUpload(blob, meta, name) {
  progress(0, 'Łączenie z YouTube…');
  $('#expProgress').hidden = false;
  const { accessToken } = await api('POST', 'youtube/token');
  const auth = { Authorization: 'Bearer ' + accessToken };
  const type = blob.type && blob.type.startsWith('video/') ? blob.type.split(';')[0] : 'video/mp4';
  const status = { privacyStatus: meta.privacy, selfDeclaredMadeForKids: meta.kids, embeddable: true };
  if (meta.publishAt) status.publishAt = meta.publishAt;
  const q = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status', notifySubscribers: String(meta.notify) });
  const init = await fetch(`${ytInfo.uploadBase}/videos?${q}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(blob.size), 'X-Upload-Content-Type': type },
    body: JSON.stringify({ snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId }, status }),
  });
  if (!init.ok) throw new Error(ytErrText(init.status, await init.text()));
  const loc = init.headers.get('Location');
  if (!loc) throw new Error('YouTube nie podał adresu wysyłki — spróbuj ponownie.');
  const t0 = performance.now();
  const video = await new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('PUT', loc);
    x.setRequestHeader('Authorization', auth.Authorization);
    x.setRequestHeader('Content-Type', type);
    x.upload.onprogress = e => { if (e.lengthComputable) progress(0.02 + 0.93 * e.loaded / e.total, `Wysyłanie na YouTube… ${fmtMB(e.loaded)} z ${fmtMB(e.total)}${etaText(t0, e.loaded / e.total)}`); };
    x.onload = () => { if (x.status < 300) { try { res(JSON.parse(x.responseText)); } catch { rej(new Error('YouTube odpowiedział nieczytelnie — sprawdź film w YouTube Studio.')); } } else rej(new Error(ytErrText(x.status, x.responseText))); };
    x.onerror = () => rej(new Error('Przerwane połączenie z YouTube — spróbuj ponownie.'));
    x.send(blob);
  });
  const notes = [];
  if (meta.thumb) {
    progress(0.97, 'Ustawianie miniatury…');
    const r = await fetch(`${ytInfo.uploadBase}/thumbnails/set?videoId=${encodeURIComponent(video.id)}`, { method: 'POST', headers: { ...auth, 'Content-Type': meta.thumb.type || 'image/jpeg' }, body: meta.thumb });
    if (!r.ok) notes.push(r.status === 403 ? 'Miniatury nie ustawiono — własne miniatury wymagają zweryfikowanego kanału (numer telefonu na youtube.com/verify).' : 'Miniatury nie udało się ustawić — dodaj ją w YouTube Studio.');
  }
  const got = video.status?.privacyStatus;
  if (got && got !== meta.privacy) notes.push(`YouTube ustawił widoczność „${YT_PRIV.find(p => p[0] === got)?.[1] || got}” — projekt Google bez audytu YouTube publikuje tylko prywatnie. Zmień ją w YouTube Studio.`);
  progress(1, '');
  const st = $('#expStatus');
  st.innerHTML = `✓ Wysłano „${esc(meta.title)}” na YouTube. <a href="https://youtu.be/${encodeURIComponent(video.id)}" target="_blank" rel="noopener">Otwórz film ↗</a> · <a href="https://studio.youtube.com/video/${encodeURIComponent(video.id)}/edit" target="_blank" rel="noopener">YouTube Studio ↗</a>${notes.map(n => `<br>⚠ ${esc(n)}`).join('')}${meta.save ? `<br>Plik zapisano też na dysku: ${esc(name)}.` : ''}`;
  toast('Film jest na YouTube', 4000);
  return video;
}
/* Wywoływane z eksportu zamiast zapisu do Pobranych, gdy film ma iść na YouTube */
async function ytFinish(blob, name) {
  const meta = ytPending;
  ytPending = null;
  if (meta.save) downloadBlob(blob, name);
  try { await ytUpload(blob, meta, name); }
  catch (ex) {
    $('#expStatus').textContent = 'Nie udało się wysłać na YouTube: ' + ex.message + (meta.save ? '' : ' Plik zapisano na dysku, żeby nie przepadł.');
    if (!meta.save) downloadBlob(blob, name);
  }
}
$('#expYt').addEventListener('click', () => openYouTubeUpload());
