'use strict';
/* record.js — nagrywanie głosu z mikrofonu prosto na oś czasu: wybór urządzenia, podgląd fali i poziomu,
   odsłuch (słyszę swój głos albo nie), czerwony przycisk. Nagranie trafia na wolną ścieżkę audio od miejsca głowicy. */

const REC_PREFS_KEY = 'cloudcut-rec';
const rec = {
  dlg: null, stream: null, src: null, an: null, mon: null, gen: 0,
  recorder: null, chunks: [], t0: 0, startedAt: 0, playAt: 0, wePlay: false,
  hist: [], peakHold: 0, peakAt: 0, buf: null, starting: false,
};
function recPrefs() {
  try { return { device: '', monitor: false, play: true, clean: true, ...JSON.parse(localStorage.getItem(REC_PREFS_KEY) || '{}') }; } catch { return { device: '', monitor: false, play: true, clean: true }; }
}
function saveRecPrefs(p) { try { localStorage.setItem(REC_PREFS_KEY, JSON.stringify({ ...recPrefs(), ...p })); } catch { /* bez zapisu */ } }
const recRecording = () => rec.recorder?.state === 'recording';

function openRecorder() {
  if (!rec.dlg) buildRecorder();
  const p = recPrefs();
  $('#recMonitor').checked = p.monitor;
  $('#recPlay').checked = p.play;
  $('#recClean').checked = p.clean;
  recUpdateWhere();
  if (!rec.dlg.open) rec.dlg.show();
  $('#recBtn').focus();
  recStartInput();
}

function buildRecorder() {
  const d = document.createElement('dialog');
  d.className = 'rec-dlg';
  d.id = 'recDlg';
  d.setAttribute('aria-labelledby', 'recTitle');
  d.innerHTML = `<div class="rec-head">
      <h2 id="recTitle"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>Nagrywanie głosu</h2>
      <button type="button" class="icon-btn" id="recClose" aria-label="Zamknij nagrywanie" title="Zamknij">✕</button>
    </div>
    <div class="field"><label for="recDevice">Mikrofon</label><select id="recDevice"><option value="">Domyślny mikrofon</option></select></div>
    <div class="rec-viz">
      <canvas id="recWave" height="84" aria-hidden="true"></canvas>
      <canvas id="recMeter" height="16" aria-hidden="true"></canvas>
      <div class="rec-scale" aria-hidden="true"><span>−60</span><span>−40</span><span>−20</span><span>−10</span><span>0 dB</span></div>
      <p class="rec-level" id="recLevel" role="status" aria-live="off">Łączenie z mikrofonem…</p>
    </div>
    <label class="check"><input type="checkbox" id="recMonitor"> Słyszę swój głos (odsłuch)</label>
    <p class="hint rec-mon-hint" id="recMonHint" hidden>Odsłuch najlepiej w słuchawkach — z głośników dźwięk wróci do mikrofonu i zacznie piszczeć.</p>
    <label class="check"><input type="checkbox" id="recPlay"> Odtwarzaj projekt podczas nagrywania</label>
    <label class="check"><input type="checkbox" id="recClean"> Tłumienie szumów i echa</label>
    <div class="rec-go">
      <button type="button" class="rec-btn" id="recBtn"><span class="rec-dot" aria-hidden="true"></span><span id="recBtnLabel">Nagrywaj</span></button>
      <div class="rec-info"><span class="rec-time" id="recTime">00:00</span><span class="hint" id="recWhere"></span></div>
    </div>`;
  document.body.appendChild(d);
  rec.dlg = d;
  $('#recClose').addEventListener('click', () => closeRecorder());
  d.addEventListener('cancel', e => { e.preventDefault(); closeRecorder(); });
  $('#recDevice').addEventListener('change', e => { saveRecPrefs({ device: e.target.value }); recStartInput(); });
  $('#recClean').addEventListener('change', e => { saveRecPrefs({ clean: e.target.checked }); if (!recRecording()) recStartInput(); });
  $('#recMonitor').addEventListener('change', e => { saveRecPrefs({ monitor: e.target.checked }); recApplyMonitor(); });
  $('#recPlay').addEventListener('change', e => saveRecPrefs({ play: e.target.checked }));
  $('#recBtn').addEventListener('click', () => (recRecording() ? recStop() : recStart()));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (rec.dlg.open) recFillDevices(); });
}

/* Mikrofon włącza się od razu po otwarciu panelu — fala i poziom pokazują, czy dźwięk dochodzi, jeszcze przed nagraniem */
async function recStartInput() {
  if (rec.starting) return;
  rec.starting = true;
  recStopInput();
  const p = recPrefs();
  const lvl = $('#recLevel');
  lvl.textContent = 'Łączenie z mikrofonem…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('brak'), { name: 'NotSupportedError' });
    const audio = { echoCancellation: p.clean, noiseSuppression: p.clean, autoGainControl: false, channelCount: { ideal: 2 } };
    if (p.device) audio.deviceId = { exact: p.device };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio }); } catch (err) {
      if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError' || !p.device) throw err;
      delete audio.deviceId; // zapamiętanego mikrofonu nie ma — bierzemy domyślny
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    }
    if (!rec.dlg.open) { stream.getTracks().forEach(t => t.stop()); return; }
    rec.stream = stream;
    const ac = ensureAudio();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    rec.src = ac.createMediaStreamSource(stream);
    rec.an = ac.createAnalyser();
    rec.an.fftSize = 2048;
    rec.buf = new Float32Array(rec.an.fftSize);
    rec.mon = ac.createGain();
    rec.src.connect(rec.an);
    rec.src.connect(rec.mon);
    rec.mon.connect(monitorGain || ac.destination);
    recApplyMonitor();
    await recFillDevices();
    rec.hist = [];
    lvl.textContent = 'Mów do mikrofonu — fala pokazuje, co słychać.';
    recLoop(++rec.gen);
  } catch (err) {
    lvl.textContent = recErrorText(err);
    await recFillDevices().catch(() => {});
  } finally {
    rec.starting = false;
  }
}
function recErrorText(err) {
  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'Brak dostępu do mikrofonu. W Windows: Ustawienia → Prywatność i zabezpieczenia → Mikrofon → włącz „Zezwalaj aplikacjom klasycznym na dostęp do mikrofonu”.';
  if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'Nie znaleziono mikrofonu — podłącz go i wybierz z listy.';
  if (err.name === 'NotReadableError') return 'Mikrofon jest zajęty przez inny program albo niedostępny — zamknij go i spróbuj ponownie.';
  if (err.name === 'NotSupportedError') return 'Ta wersja programu nie obsługuje nagrywania z mikrofonu.';
  return 'Nie udało się włączyć mikrofonu: ' + (err.message || err.name);
}
function recStopInput() {
  rec.gen++; // zatrzymuje pętlę rysowania
  try { rec.src?.disconnect(); rec.mon?.disconnect(); } catch { /* już odłączone */ }
  rec.stream?.getTracks().forEach(t => t.stop());
  rec.stream = rec.src = rec.an = rec.mon = null;
}
function recApplyMonitor() {
  const on = $('#recMonitor').checked;
  $('#recMonHint').hidden = !on;
  if (rec.mon) rec.mon.gain.setTargetAtTime(on ? 1 : 0, audioCtx.currentTime, 0.02);
}
async function recFillDevices() {
  const sel = $('#recDevice');
  const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications');
  const cur = rec.stream?.getAudioTracks()[0]?.getSettings().deviceId || recPrefs().device;
  sel.innerHTML = list.length
    ? list.map((d, i) => `<option value="${d.deviceId === 'default' ? '' : esc(d.deviceId)}">${esc(d.label || `Mikrofon ${i + 1}`)}</option>`).join('')
    : '<option value="">Brak mikrofonów</option>';
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  sel.disabled = recRecording();
}

/* Fala przesuwa się od prawej do lewej (każdy słupek = jedna klatka obrazu), pod nią miernik poziomu z pikiem */
/* co klatkę obrazu (w tle co 1/fps s — schedule z render.js), dopóki panel ma włączony mikrofon */
function recLoop(gen) {
  if (gen !== rec.gen) return;
  recDraw();
  schedule(() => recLoop(gen));
}
function recDraw() {
  const an = rec.an;
  if (!an) return;
  an.getFloatTimeDomainData(rec.buf);
  let pk = 0, sum = 0;
  for (const v of rec.buf) { const a = Math.abs(v); if (a > pk) pk = a; sum += v * v; }
  const rms = Math.sqrt(sum / rec.buf.length);
  const now = performance.now();
  if (pk >= rec.peakHold || now - rec.peakAt > 1500) { rec.peakHold = pk; rec.peakAt = now; }
  const wave = $('#recWave'), dpr = devicePixelRatio || 1;
  const W = Math.max(1, Math.round(wave.clientWidth * dpr)), H = Math.round(84 * dpr);
  if (wave.width !== W || wave.height !== H) { wave.width = W; wave.height = H; }
  const recording = recRecording();
  const bw = Math.max(2, Math.round(3 * dpr)), cols = Math.ceil(W / bw);
  rec.hist.push({ pk, rec: recording });
  if (rec.hist.length > cols) rec.hist.splice(0, rec.hist.length - cols);
  const g = wave.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.07)';
  g.fillRect(0, H / 2 - dpr / 2, W, dpr);
  for (let i = 0; i < rec.hist.length; i++) {
    const h = rec.hist[rec.hist.length - 1 - i];
    const x = W - (i + 1) * bw;
    const amp = Math.max(dpr, Math.sqrt(h.pk) * (H / 2 - 2 * dpr)); // pierwiastek: ciche dźwięki też są widoczne
    g.fillStyle = h.pk > 0.98 ? '#ff4d5e' : h.rec ? '#ff7a7a' : h.pk > 0.5 ? '#f2c94c' : '#2fbf71';
    g.fillRect(x, H / 2 - amp, bw - Math.max(1, dpr), amp * 2);
  }
  const meter = $('#recMeter');
  const MW = Math.max(1, Math.round(meter.clientWidth * dpr)), MH = Math.round(16 * dpr);
  if (meter.width !== MW || meter.height !== MH) { meter.width = MW; meter.height = MH; }
  const m = meter.getContext('2d');
  const pos = v => clamp((20 * Math.log10(v || 1e-6) + 60) / 60, 0, 1) * MW;
  m.fillStyle = '#1a1d24'; m.fillRect(0, 0, MW, MH);
  const grd = m.createLinearGradient(0, 0, MW, 0);
  grd.addColorStop(0, '#2fbf71'); grd.addColorStop(0.75, '#2fbf71'); grd.addColorStop(0.87, '#f2c94c'); grd.addColorStop(1, '#ff4d5e');
  m.fillStyle = grd;
  m.fillRect(0, 0, pos(pk), MH);
  m.fillStyle = 'rgba(255,255,255,.35)';
  m.fillRect(0, MH * 0.7, pos(rms), MH * 0.3);
  m.fillStyle = '#fff';
  m.fillRect(Math.min(MW - 2 * dpr, pos(rec.peakHold)), 0, 2 * dpr, MH);
  if (recording) $('#recTime').textContent = recClock((now - rec.startedAt) / 1000);
  const db = 20 * Math.log10(rec.peakHold || 1e-6);
  const txt = rec.peakHold > 0.98 ? 'Za głośno — przesteruje! Odsuń mikrofon albo ścisz wejście.' : db < -45 ? 'Bardzo cicho — mów bliżej mikrofonu.' : `Poziom ${Math.round(db)} dB — ${db > -6 ? 'głośno, ale w porządku' : 'dobrze'}`;
  const lvl = $('#recLevel');
  if (lvl.textContent !== txt && now - (rec.txtAt || 0) > 250) { lvl.textContent = txt; rec.txtAt = now; }
  if (!recording) recUpdateWhere(); // głowica mogła się przesunąć
}
const recClock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function recUpdateWhere() {
  const el = $('#recWhere');
  const txt = `Nagranie trafi na ścieżkę audio od ${tc(playhead)}.`;
  if (el && !recRecording() && el.textContent !== txt) el.textContent = txt;
}

function recStart() {
  if (!rec.stream) { toast('Mikrofon nie jest włączony — wybierz urządzenie z listy'); recStartInput(); return; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  let r;
  try { r = new MediaRecorder(rec.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 192000 }); } catch (err) { toast('Nie udało się rozpocząć nagrywania: ' + err.message, 5000); return; }
  rec.recorder = r;
  rec.chunks = [];
  rec.t0 = playhead;
  r.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  r.onstart = () => { rec.startedAt = performance.now(); };
  r.onstop = () => recFinish(r.mimeType || mime || 'audio/webm');
  r.start(1000);
  rec.startedAt = performance.now();
  rec.wePlay = $('#recPlay').checked && !playing;
  rec.playAt = performance.now();
  if (rec.wePlay) play();
  $('#recBtn').classList.add('on');
  $('#recBtnLabel').textContent = 'Zatrzymaj';
  $('#recDevice').disabled = true;
  $('#recClean').disabled = true;
  $('#recWhere').textContent = `Nagrywanie od ${tc(rec.t0)} — kliknij, żeby zakończyć.`;
  document.body.classList.add('is-recording');
}
function recStop() {
  if (!recRecording()) return;
  rec.recorder.stop();
  if (rec.wePlay && playing) pause();
}
async function recFinish(type) {
  // dźwięk zaczął się nagrywać chwilę po starcie odtwarzania — przesuwamy klip o tę różnicę, żeby głos był w punkt
  const lag = rec.wePlay ? clamp((rec.startedAt - rec.playAt) / 1000, 0, 1) : 0;
  const at = rec.t0 + lag;
  const blob = new Blob(rec.chunks, { type });
  rec.chunks = [];
  rec.recorder = null;
  $('#recBtn').classList.remove('on');
  $('#recBtnLabel').textContent = 'Nagrywaj';
  $('#recDevice').disabled = false;
  $('#recClean').disabled = false;
  document.body.classList.remove('is-recording');
  if (blob.size < 200) { toast('Nagranie jest puste — sprawdź mikrofon'); recUpdateWhere(); return; }
  const d = new Date();
  const name = `Nagranie ${d.toLocaleDateString('pl-PL')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}.webm`;
  toast('Zapisywanie nagrania…', 10000);
  const m = await importBlob(blob, name);
  if (!m) { toast('Nie udało się wczytać nagrania', 5000); return; }
  const dur = Math.max(frame(), m.duration);
  const tr = state.tracks.find(t => t.kind === 'audio' && !t.locked && !overlaps(t.id, at, at + dur)) || addTrack('audio', false);
  placeMedia(m, { t: at, trackId: tr.id });
  toast(`Nagranie (${recClock(m.duration)}) jest na ścieżce ${tr.name}`);
  recUpdateWhere();
}
function closeRecorder() {
  if (recRecording()) recStop(); // nagranie nie przepada — zapisze się po zatrzymaniu
  recStopInput();
  rec.dlg?.close();
  $('#btnRecord')?.focus();
}
