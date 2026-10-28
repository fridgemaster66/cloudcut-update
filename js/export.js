'use strict';
/* export.js — eksport do formatów wideo, animacji, zdjęć, sekwencji klatek i dźwięku */

/* =========================================================
   Formaty
   type: rec (nagrywanie w czasie rzeczywistym), arec (sam dźwięk na żywo), wav, gif, avi, seq, image, none (niedostępny)
   ========================================================= */
const H264 = ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.4d0028', 'avc1.42e01f', 'avc1'];
const recMimes = (container, vcodecs, acodecs) => vcodecs.flatMap(v => acodecs.map(a => `${container};codecs=${v},${a}`)).concat([container]);
const EXPORT_FORMATS = [
  { g: 'Wideo', id: 'mp4', label: 'MP4 — H.264 (działa wszędzie)', type: 'rec', ext: 'mp4', mb: { fmt: 'Mp4', v: 'avc', a: ['aac', 'opus'] }, mimes: recMimes('video/mp4', H264, ['mp4a.40.2', 'opus']) },
  { g: 'Wideo', id: 'mp4-hevc', label: 'MP4 — H.265 / HEVC (mniejszy plik)', type: 'rec', ext: 'mp4', mb: { fmt: 'Mp4', v: 'hevc', a: ['aac', 'opus'] }, mimes: recMimes('video/mp4', ['hvc1.1.6.L153.B0', 'hvc1.1.6.L123.B0', 'hev1.1.6.L123.B0', 'hvc1'], ['mp4a.40.2', 'opus']).slice(0, -1) },
  { g: 'Wideo', id: 'mp4-av1', label: 'MP4 — AV1 (najnowszy kodek)', type: 'rec', ext: 'mp4', mb: { fmt: 'Mp4', v: 'av1', a: ['aac', 'opus'] }, mimes: recMimes('video/mp4', ['av01.0.08M.08', 'av01.0.05M.08', 'av01'], ['mp4a.40.2', 'opus']).slice(0, -1) },
  { g: 'Wideo', id: 'mp4-vp9', label: 'MP4 — VP9', type: 'rec', ext: 'mp4', mb: { fmt: 'Mp4', v: 'vp9', a: ['opus', 'aac'] }, mimes: recMimes('video/mp4', ['vp09.00.40.08', 'vp9'], ['opus', 'mp4a.40.2']).slice(0, -1) },
  { g: 'Wideo', id: 'mov', label: 'MOV — H.264 (QuickTime, Final Cut)', type: 'rec', ext: 'mov', mb: { fmt: 'Mov', v: 'avc', a: ['aac'] }, mimes: recMimes('video/mp4', H264, ['mp4a.40.2']) },
  { g: 'Wideo', id: 'ts', label: 'MPEG-TS (.ts) — H.264 (telewizja, nadawanie)', type: 'rec', ext: 'ts', mb: { fmt: 'MpegTs', v: 'avc', a: ['aac'] }, mimes: [] },
  { g: 'Wideo', id: 'webm-vp9', label: 'WebM — VP9 (strony internetowe)', type: 'rec', ext: 'webm', mb: { fmt: 'WebM', v: 'vp9', a: ['opus'] }, mimes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp09.00.40.08,opus'] },
  { g: 'Wideo', id: 'webm-vp8', label: 'WebM — VP8', type: 'rec', ext: 'webm', mb: { fmt: 'WebM', v: 'vp8', a: ['opus'] }, mimes: ['video/webm;codecs=vp8,opus', 'video/webm'] },
  { g: 'Wideo', id: 'webm-av1', label: 'WebM — AV1', type: 'rec', ext: 'webm', mb: { fmt: 'WebM', v: 'av1', a: ['opus'] }, mimes: ['video/webm;codecs=av01,opus', 'video/webm;codecs=av1,opus', 'video/webm;codecs=av01.0.08M.08,opus'] },
  { g: 'Wideo', id: 'mkv-h264', label: 'MKV — H.264 (Matroska)', type: 'rec', ext: 'mkv', mb: { fmt: 'Mkv', v: 'avc', a: ['aac', 'opus'] }, mimes: ['video/x-matroska;codecs=avc1,opus', 'video/x-matroska;codecs=avc1.640028,opus'] },
  { g: 'Wideo', id: 'mkv-hevc', label: 'MKV — H.265 / HEVC (Matroska)', type: 'rec', ext: 'mkv', mb: { fmt: 'Mkv', v: 'hevc', a: ['aac', 'opus'] }, mimes: [] },
  { g: 'Wideo', id: 'mkv-vp9', label: 'MKV — VP9 (Matroska)', type: 'rec', ext: 'mkv', mb: { fmt: 'Mkv', v: 'vp9', a: ['opus'] }, mimes: ['video/x-matroska;codecs=vp9,opus', 'video/x-matroska;codecs=vp9'] },
  { g: 'Wideo', id: 'mkv-av1', label: 'MKV — AV1 (Matroska)', type: 'rec', ext: 'mkv', mb: { fmt: 'Mkv', v: 'av1', a: ['opus'] }, mimes: ['video/x-matroska;codecs=av01,opus', 'video/x-matroska;codecs=av1,opus'] },
  { g: 'Wideo', id: 'avi', label: 'AVI — Motion JPEG + dźwięk PCM (starsze programy)', type: 'avi', ext: 'avi', note: 'AVI zapisuje każdą klatkę jako zdjęcie — bardzo duże pliki.' },
  { g: 'Wideo', id: 'x-wmv', label: 'WMV, FLV, ProRes, MPEG-2 — wymagają programu na komputerze', type: 'none' },

  { g: 'Animacja', id: 'gif', label: 'GIF animowany', type: 'gif', ext: 'gif', note: 'GIF ma 256 kolorów — najlepiej sprawdza się w krótkich, małych animacjach.' },

  { g: 'Zdjęcie (bieżąca klatka)', id: 'png', label: 'PNG (bez strat)', type: 'image', ext: 'png', mime: 'image/png' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'jpg', label: 'JPEG', type: 'image', ext: 'jpg', mime: 'image/jpeg' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'webp', label: 'WebP', type: 'image', ext: 'webp', mime: 'image/webp' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'avif', label: 'AVIF', type: 'image', ext: 'avif', mime: 'image/avif' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'tiff', label: 'TIFF (bez kompresji, do druku)', type: 'image', ext: 'tiff', enc: 'tiff' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'bmp', label: 'BMP', type: 'image', ext: 'bmp', enc: 'bmp' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'gif1', label: 'GIF (pojedyncza klatka)', type: 'image', ext: 'gif', enc: 'gif' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'ico', label: 'ICO (ikona 256×256)', type: 'image', ext: 'ico', enc: 'ico' },
  { g: 'Zdjęcie (bieżąca klatka)', id: 'x-heic', label: 'HEIC, JPEG XL, PSD, RAW — wymagają programu na komputerze', type: 'none' },

  { g: 'Sekwencja klatek (ZIP)', id: 'seq-png', label: 'Sekwencja PNG', type: 'seq', ext: 'zip', mime: 'image/png', fext: 'png' },
  { g: 'Sekwencja klatek (ZIP)', id: 'seq-jpg', label: 'Sekwencja JPEG', type: 'seq', ext: 'zip', mime: 'image/jpeg', fext: 'jpg' },
  { g: 'Sekwencja klatek (ZIP)', id: 'seq-webp', label: 'Sekwencja WebP', type: 'seq', ext: 'zip', mime: 'image/webp', fext: 'webp' },

  { g: 'Sam dźwięk', id: 'wav', label: 'WAV (bez strat)', type: 'wav', ext: 'wav' },
  { g: 'Sam dźwięk', id: 'mp3', label: 'MP3', type: 'arec', ext: 'mp3', mb: { fmt: 'Mp3', a: ['mp3'] }, mimes: [] },
  { g: 'Sam dźwięk', id: 'm4a', label: 'M4A — AAC', type: 'arec', ext: 'm4a', mb: { fmt: 'Mp4', a: ['aac'] }, mimes: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'] },
  { g: 'Sam dźwięk', id: 'aac', label: 'AAC (ADTS)', type: 'arec', ext: 'aac', mb: { fmt: 'Adts', a: ['aac'] }, mimes: [] },
  { g: 'Sam dźwięk', id: 'flac', label: 'FLAC (bez strat, kompresja)', type: 'arec', ext: 'flac', mb: { fmt: 'Flac', a: ['flac'] }, mimes: [] },
  { g: 'Sam dźwięk', id: 'ogg', label: 'OGG — Opus', type: 'arec', ext: 'ogg', mb: { fmt: 'Ogg', a: ['opus', 'vorbis'] }, mimes: ['audio/ogg;codecs=opus', 'audio/ogg'] },
  { g: 'Sam dźwięk', id: 'opus-webm', label: 'WebM — Opus', type: 'arec', ext: 'webm', mb: { fmt: 'WebM', a: ['opus'] }, mimes: ['audio/webm;codecs=opus', 'audio/webm'] },
  { g: 'Sam dźwięk', id: 'x-aiff', label: 'AIFF, WMA, AC-3 — wymagają programu na komputerze', type: 'none' },
];
const FMT_BY_ID = new Map(EXPORT_FORMATS.map(f => [f.id, f]));
const FPS_LIST = [12, 15, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const COMP = { bpp: [0.25, 0.12, 0.07, 0.035], q: [0.95, 0.88, 0.78, 0.62] };

const canEncodeImage = (() => {
  const cache = new Map();
  return mime => {
    if (!cache.has(mime)) {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      cache.set(mime, c.toDataURL(mime).startsWith('data:' + mime));
    }
    return cache.get(mime);
  };
})();
/* Szybki eksport (WebCodecs + mediabunny): sprawdzenie, które kodeki przeglądarka umie kodować */
let fastCaps = null;
async function computeFastCaps() {
  if (fastCaps) return fastCaps;
  fastCaps = new Map();
  if (!window.VideoEncoder || !window.AudioEncoder) return fastCaps;
  let mb;
  try {
    mb = await loadMediabunny();
    try { const ext = await import('/vendor/mediabunny-mp3-encoder.mjs'); if (!(await mb.canEncodeAudio('mp3'))) ext.registerMp3Encoder(); } catch (err) { console.warn('Brak kodera MP3', err); }
  } catch (err) { console.warn('Szybki eksport niedostępny', err); return fastCaps; }
  const W = even(state.w), H = even(state.h);
  const vOk = new Map(), aOk = new Map();
  for (const f of EXPORT_FORMATS) {
    if (!f.mb) continue;
    let v = true;
    if (f.mb.v) {
      if (!vOk.has(f.mb.v)) vOk.set(f.mb.v, await mb.canEncodeVideo(f.mb.v, { width: W, height: H }).catch(() => false));
      v = vOk.get(f.mb.v);
    }
    let a = null;
    for (const codec of f.mb.a || []) {
      if (!aOk.has(codec)) aOk.set(codec, await mb.canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false));
      if (aOk.get(codec)) { a = codec; break; }
    }
    if (v && (a || !f.mb.a)) fastCaps.set(f.id, { v: f.mb.v || null, a });
  }
  return fastCaps;
}
function formatMime(f) {
  if (fastCaps?.has(f.id)) return 'fast';
  if (f.type === 'rec' || f.type === 'arec') return window.MediaRecorder ? f.mimes.find(m => MediaRecorder.isTypeSupported(m)) || null : null;
  if (f.type === 'image' && f.mime) return canEncodeImage(f.mime) ? f.mime : null;
  if (f.type === 'seq') return canEncodeImage(f.mime) ? f.mime : null;
  if (f.type === 'none') return null;
  return 'ok';
}
const kindOfFormat = f => (['wav', 'arec'].includes(f.type) ? 'audio' : f.type === 'image' ? 'image' : 'video');

/* =========================================================
   Okno eksportu
   ========================================================= */
const expDlg = $('#exportDlg');
let lastFmt = 'mp4';
try { lastFmt = localStorage.getItem('cloudcut-export-fmt') || 'mp4'; } catch { /* brak */ }
const even = v => Math.max(2, Math.round(v / 2) * 2);

function buildFormatSelect() {
  const groups = [...new Set(EXPORT_FORMATS.map(f => f.g))];
  $('#expFmt').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${EXPORT_FORMATS.filter(f => f.g === g).map(f => {
    const ok = formatMime(f);
    const lbl = f.type === 'none' ? f.label : ok === 'fast' ? `${f.label}  ⚡` : ok ? f.label : `${f.label} — niedostępny w tej przeglądarce`;
    return `<option value="${f.id}"${ok ? '' : ' disabled'}>${esc(lbl)}</option>`;
  }).join('')}</optgroup>`).join('');
  const sel0 = FMT_BY_ID.get(lastFmt);
  $('#expFmt').value = sel0 && formatMime(sel0) ? lastFmt : 'mp4';
}
function fillQuality() {
  const f = FMT_BY_ID.get($('#expFmt').value);
  const kind = kindOfFormat(f);
  const q = $('#expQuality');
  const prev = q.value;
  $('#expQualityLbl').textContent = kind === 'audio' ? 'Jakość dźwięku' : 'Jakość (rozdzielczość)';
  if (kind === 'audio') {
    q.innerHTML = f.type === 'wav'
      ? '<option value="16">16 bit, 48 kHz (CD+)</option><option value="24">24 bit, 48 kHz (studio)</option><option value="32">32 bit zmiennoprzecinkowy, 48 kHz</option>'
      : (fastCaps?.get(f.id)?.a === 'aac'
        ? '<option value="192000" selected>192 kb/s (najwyższa dla AAC)</option><option value="160000">160 kb/s</option><option value="128000">128 kb/s</option><option value="96000">96 kb/s (mały plik)</option>'
        : '<option value="320000">320 kb/s (najwyższa)</option><option value="256000" selected>256 kb/s</option><option value="192000">192 kb/s</option><option value="128000">128 kb/s</option><option value="96000">96 kb/s (mały plik)</option>');
  } else if (f.enc === 'ico') {
    q.innerHTML = '<option value="ico">256×256 (ikona)</option>';
  } else {
    const short = Math.min(state.w, state.h);
    const opts = [[1, `Oryginalna — ${state.w}×${state.h}`]];
    for (const p of [4320, 2160, 1440, 1080, 720, 540, 480, 360, 240]) {
      const s = p / short;
      if (Math.abs(s - 1) < 0.002) continue;
      if (s > 4) continue;
      opts.push([s, `${p}p${p === 4320 ? ' (8K)' : p === 2160 ? ' (4K)' : p === 1440 ? ' (2K)' : p === 1080 ? ' (Full HD)' : p === 720 ? ' (HD)' : ''} — ${even(state.w * s)}×${even(state.h * s)}`]);
    }
    opts.sort((a, b) => b[0] - a[0]);
    q.innerHTML = opts.map(([s, l]) => `<option value="${s}">${l}</option>`).join('');
    const def = f.type === 'gif' ? opts.reduce((b, o) => (Math.abs(Math.min(state.w, state.h) * o[0] - 480) < Math.abs(Math.min(state.w, state.h) * b[0] - 480) ? o : b))[0] : 1;
    q.value = [...q.options].some(o => o.value === prev) && f.type !== 'gif' ? prev : String(def);
  }
  if (![...q.options].some(o => o.selected)) q.selectedIndex = 0;
}
function fillFps() {
  const f = FMT_BY_ID.get($('#expFmt').value);
  const el = $('#expFps');
  const kind = kindOfFormat(f);
  if (kind !== 'video') {
    el.innerHTML = `<option value="">${kind === 'audio' ? '— (sam dźwięk)' : '— (jedna klatka)'}</option>`;
    el.disabled = true;
    return;
  }
  el.disabled = false;
  const list = f.type === 'gif' ? FPS_LIST.filter(x => x <= 50) : FPS_LIST;
  const prev = +el.value;
  el.innerHTML = list.map(x => `<option value="${x}">${String(x).replace('.', ',')} kl./s${x === state.fps ? ' (projekt)' : ''}</option>`).join('');
  el.value = String(f.type === 'gif' ? (list.includes(prev) && prev <= 25 ? prev : 15) : (list.includes(prev) ? prev : state.fps));
}
function refreshExportForm() {
  const f = FMT_BY_ID.get($('#expFmt').value);
  fillQuality();
  fillFps();
  const kind = kindOfFormat(f);
  $('#expRangeWrap').hidden = kind === 'image';
  $('#expCompWrap').hidden = kind === 'audio' || ['png', 'tiff', 'bmp', 'gif1', 'ico', 'gif', 'seq-png'].includes(f.id);
  $('#expRange').querySelector('[value="io"]').disabled = !state.range;
  updateExpInfo();
}
function exportRange() {
  return $('#expRange').value === 'io' && state.range ? { in: state.range.in, out: state.range.out } : { in: 0, out: projectEnd() };
}
function updateExpInfo() {
  const f = FMT_BY_ID.get($('#expFmt').value);
  const mime = formatMime(f);
  const kind = kindOfFormat(f);
  const r = exportRange();
  let txt;
  if (!mime) txt = 'Ten format nie jest dostępny w tej przeglądarce. Najwięcej formatów obsługuje aktualny Chrome lub Edge.';
  else if (kind === 'image') txt = `Zapisze klatkę z miejsca głowicy (${tc(playhead)}).`;
  else if (mime === 'fast') txt = `⚡ Szybki eksport: długość ${shortDur(r.out - r.in)}, kodowanie sprzętowe klatka po klatce — zwykle kilka razy szybciej niż odtwarzanie.`;
  else if (f.type === 'rec' || f.type === 'arec') txt = `Długość ${shortDur(r.out - r.in)}. Ta przeglądarka nie ma szybkiego kodera dla tego formatu, więc eksport trwa tyle, ile film — zostaw tę kartę na wierzchu.`;
  else if (f.type === 'wav') txt = `Długość ${shortDur(r.out - r.in)}. Dźwięk liczy się szybciej niż w czasie rzeczywistym.`;
  else {
    const frames = Math.ceil((r.out - r.in) * (+$('#expFps').value || state.fps));
    txt = `${frames} klatek renderowanych po kolei — dokładnie, ale wolniej niż odtwarzanie.`;
  }
  if (f.note && mime) txt += ' ' + f.note;
  $('#expInfo').textContent = txt;
  $('#expStart').disabled = !mime || (kind !== 'image' && r.out - r.in < 0.05);
}
async function openExport() {
  if (exporting) { expDlg.showModal(); return; }
  if (projectEnd() <= 0) { toast('Oś czasu jest pusta — nie ma czego eksportować'); return; }
  if (!fastCaps) { $('#expFmt').innerHTML = '<option>Sprawdzam kodeki…</option>'; expDlg.showModal(); await computeFastCaps(); }
  buildFormatSelect();
  $('#expRange').value = state.range ? 'io' : 'all';
  $('#expProgress').hidden = true;
  $('#expStatus').textContent = '';
  $('#expCancel').textContent = 'Anuluj';
  setExpForm(true);
  refreshExportForm();
  if (!expDlg.open) expDlg.showModal();
}
function setExpForm(on) {
  for (const id of ['#expFmt', '#expRange', '#expQuality', '#expComp', '#expLoud', '#expYt']) $(id).disabled = !on;
  $('#expFps').disabled = !on || kindOfFormat(FMT_BY_ID.get($('#expFmt').value)) !== 'video';
  $('#expStart').disabled = !on;
  if (on) updateExpInfo();
}
$('#expFmt').addEventListener('change', () => { lastFmt = $('#expFmt').value; try { localStorage.setItem('cloudcut-export-fmt', lastFmt); } catch { /* brak */ } refreshExportForm(); });
for (const id of ['#expRange', '#expFps', '#expQuality']) $(id).addEventListener('change', updateExpInfo);
try { $('#expLoud').value = localStorage.getItem('cloudcut-export-loud') || '0'; } catch { /* bez zapisu */ }
$('#expLoud').addEventListener('change', e => { try { localStorage.setItem('cloudcut-export-loud', e.target.value); } catch { /* bez zapisu */ } });

/* =========================================================
   Wspólne narzędzia eksportu
   ========================================================= */
function setExportCanvas(scale) {
  const W = even(state.w * scale), H = even(state.h * scale);
  renderScale = W / state.w;
  canvas.width = W; canvas.height = H;
  return { W, H };
}
function restorePreview() {
  setRenderScale(ui?.previewQ ?? renderScale);
  drawFrame();
}
function progress(p, msg) {
  $('#expBar').style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%';
  if (msg) $('#expStatus').textContent = msg;
}
function etaText(t0, p) {
  if (p < 0.02) return '';
  const el = (performance.now() - t0) / 1000;
  return ` · zostało ok. ${shortDur(Math.max(0, el / p - el))}`;
}
function exportName(ext) { return `${safeName($('#projName').value)}.${ext}`; }
function finishWith(blob, name) {
  if (typeof ytPending !== 'undefined' && ytPending && /^video\//.test(blob.type || 'video/')) { ytFinish(blob, name); return; }
  downloadBlob(blob, name);
  progress(1, `Gotowe — zapisano „${name}” (${(blob.size / 1048576).toFixed(1)} MB). Plik jest w folderze Pobrane.`);
}

/* Klatka w dokładnym miejscu — czeka, aż wszystkie filmy przewiną się na właściwą klatkę */
async function renderFrameAt(t) {
  playhead = t;
  const t0 = performance.now();
  for (;;) {
    syncMedia();
    let busy = false;
    for (const c of state.clips) {
      if (c.off || c.kind !== 'video' || exportFrames?.has(c.id)) continue; // klatka z dekodera nie wymaga przewijania
      if (t < c.start || t >= clipEnd(c) + (frameTails.get(c.id) || 0)) continue;
      const p = players.get(pkey(c));
      if (!p) continue;
      const target = srcTimeOf(c, t);
      if (p.el.seeking || p.el.readyState < 2 || (Math.abs(p.el.currentTime - target) > frame() / 2 && target < (p.el.duration || 1e9) - 0.05)) { busy = true; break; }
    }
    if (!busy || performance.now() - t0 > 4000) break;
    await sleep(6);
  }
  drawFrame();
}

/* Klatki filmów prosto z dekodera (WebCodecs) — bez przewijania odtwarzaczy, więc szybko i co do klatki */
class FrameFeeder {
  constructor(mb) { this.mb = mb; this.sinks = new Map(); this.its = new Map(); this.rev = new Map(); }
  async sinkFor(mediaId) {
    if (this.sinks.has(mediaId)) return this.sinks.get(mediaId);
    let sink = null;
    try {
      const m = media.get(mediaId);
      const input = new this.mb.Input({ source: new this.mb.BlobSource(m.blob), formats: this.mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && await track.canDecode()) sink = new this.mb.CanvasSink(track, { poolSize: 0 });
    } catch (err) { console.warn('Dekoder niedostępny dla pliku, używam odtwarzacza', err); }
    this.sinks.set(mediaId, sink);
    return sink;
  }
  async frameFor(c, t) {
    const sink = await this.sinkFor(c.mediaId);
    if (!sink) return null;
    const target = srcTimeOf(c, t);
    if (c.speed < 0) return this.reverseFrame(c, sink, target);
    let st = this.its.get(c.id);
    // cofnięcie albo duży skok do przodu (szybkie klipy): dekoder zaczyna od najbliższej klatki kluczowej
    if (!st || (st.cur && (target < st.cur.timestamp - 0.002 || target > st.cur.timestamp + 4))) {
      st?.it.return?.();
      st = { it: sink.canvases(Math.max(0, target - 0.001)), cur: null, next: null };
      const r = await st.it.next();
      st.next = r.done ? null : r.value;
      this.its.set(c.id, st);
    }
    while (st.next && st.next.timestamp <= target + 1e-4) {
      st.cur = st.next;
      const r = await st.it.next();
      st.next = r.done ? null : r.value;
    }
    if (!st.cur && st.next) st.cur = st.next;
    return st.cur?.canvas || null;
  }
  /* Wstecz: dekoder idzie tylko do przodu, więc kawałek pliku przed bieżącym miejscem dekodujemy w całości
     (ok. 250 MB klatek) i oddajemy klatki od końca */
  async reverseFrame(c, sink, target) {
    let b = this.rev.get(c.id);
    if (!b || target < b.from - 1e-4 || target > b.to + 1e-4) {
      const m = media.get(c.mediaId);
      const len = clamp(250e6 / (Math.max(1, (m?.w || 1920) * (m?.h || 1080)) * 4) / 30, 0.1, 1);
      const from = Math.max(0, target - len), frames = [];
      this.rev.delete(c.id); // poprzedni kawałek do zwolnienia, zanim zdekodujemy następny
      for await (const f of sink.canvases(from, target + 0.001)) frames.push(f);
      b = { from, to: target, frames };
      this.rev.set(c.id, b);
    }
    let best = null;
    for (const f of b.frames) { if (f.timestamp <= target + 1e-4) best = f; else break; }
    return (best || b.frames[0])?.canvas || null;
  }
  async prepare(t) {
    const tails = computeTails();
    const map = new Map();
    for (const c of state.clips) {
      if (c.kind !== 'video' || c.off || !media.has(c.mediaId)) continue;
      if (t < c.start || t >= clipEnd(c) + (tails.get(c.id) || 0)) continue;
      const tr = trackOf(c);
      if (!tr || tr.hidden) continue;
      const f = await this.frameFor(c, t);
      if (f) map.set(c.id, f);
    }
    exportFrames = map;
  }
  dispose() {
    for (const st of this.its.values()) st.it.return?.();
    this.its.clear();
    this.rev.clear();
    exportFrames = null;
  }
}
async function makeFeeder() {
  if (!window.VideoDecoder) return null;
  try { return new FrameFeeder(await loadMediabunny()); } catch { return null; }
}

/* Pełny opis kodeka dla WebCodecs — poziom dobrany do rozdzielczości i liczby klatek */
async function pickEncoderConfig(codec, width, height, fps, bitrate) {
  const big = width * height > 1920 * 1088 || fps > 30.5;
  const cands = {
    avc: big ? ['avc1.640033', 'avc1.64002a', 'avc1.4d0033'] : ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f'],
    hevc: big ? ['hvc1.1.6.L153.B0', 'hev1.1.6.L153.B0'] : ['hvc1.1.6.L123.B0', 'hev1.1.6.L123.B0', 'hvc1.1.6.L120.90'],
    vp9: big ? ['vp09.00.50.08', 'vp09.00.41.08'] : ['vp09.00.40.08', 'vp09.00.31.08'],
    av1: big ? ['av01.0.12M.08', 'av01.0.09M.08'] : ['av01.0.08M.08', 'av01.0.05M.08'],
    vp8: ['vp8'],
  }[codec] || [];
  for (const hw of ['prefer-hardware', 'no-preference']) {
    for (const c of cands) {
      const cfg = { codec: c, width, height, bitrate, framerate: fps, latencyMode: 'quality', hardwareAcceleration: hw };
      if (codec === 'avc') cfg.avc = { format: 'avc' };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* następny */ }
    }
  }
  return null;
}

/* Szybki eksport: klatki z dekodera → koder WebCodecs → plik (MP4/MOV/TS/WebM/MKV/MP3/M4A/AAC/OGG) */
async function fastExport(f, rng, fps, comp, qual) {
  const mb = await loadMediabunny();
  const caps = fastCaps.get(f.id);
  const fmtClass = mb[f.mb.fmt + 'OutputFormat'];
  const fmtOpts = ['Mp4', 'Mov'].includes(f.mb.fmt) ? { fastStart: 'in-memory' } : {};
  const output = new mb.Output({ format: new fmtClass(fmtOpts), target: new mb.BufferTarget() });
  exporting.output = output;
  let vSrc = null, aSrc = null, venc = null;
  const kind = kindOfFormat(f);
  if (kind === 'video') {
    setExportCanvas(+qual);
    const bitrate = Math.round(canvas.width * canvas.height * fps * COMP.bpp[comp]);
    // bezpośredni VideoEncoder (kilka razy szybszy niż kodowanie przez źródło płótna)
    const cfg = await pickEncoderConfig(caps.v, canvas.width, canvas.height, fps, bitrate);
    if (cfg) {
      vSrc = new mb.EncodedVideoPacketSource(caps.v);
      venc = { cfg, chain: Promise.resolve(), error: null };
    } else vSrc = new mb.CanvasSource(canvas, { codec: caps.v, bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(vSrc, { frameRate: fps });
  }
  if (caps.a) {
    let abr = kind === 'audio' && f.mb.fmt !== 'Flac' ? +qual || 192000 : 192000;
    if (caps.a === 'aac') abr = Math.min(abr, 192000); // systemowy koder AAC (Windows) przyjmuje najwyżej 192 kb/s
    aSrc = new mb.AudioBufferSource(caps.a === 'flac' ? { codec: 'flac' } : { codec: caps.a, bitrate: abr });
    output.addAudioTrack(aSrc);
  }
  progress(0.01, 'Liczenie dźwięku…');
  const mix = caps.a ? await exportMix(rng.in, rng.out) : null;
  await output.start();
  const sliceOf = (a, b) => {
    // fragment miksu [a, b) jako osobny AudioBuffer (dokładany po kolei do kodera)
    const sr = mix.sampleRate, i0 = Math.floor(a * sr), i1 = Math.min(mix.length, Math.floor(b * sr));
    if (i1 <= i0) return null;
    const out = new AudioBuffer({ length: i1 - i0, numberOfChannels: mix.numberOfChannels, sampleRate: sr });
    for (let ch = 0; ch < mix.numberOfChannels; ch++) out.copyToChannel(mix.getChannelData(ch).subarray(i0, i1), ch);
    return out;
  };
  if (vSrc) {
    const feeder = await makeFeeder();
    exporting.feeder = feeder;
    const n = Math.max(1, Math.round((rng.out - rng.in) * fps));
    let audioAt = 0;
    let encoder = null;
    if (venc) {
      encoder = new VideoEncoder({
        output: (chunk, meta) => { const pkt = mb.EncodedPacket.fromEncodedChunk(chunk); venc.chain = venc.chain.then(() => vSrc.add(pkt, meta)); },
        error: e => { venc.error = e; },
      });
      encoder.configure(venc.cfg);
      exporting.encoder = encoder;
    }
    const dur = Math.round(1e6 / fps), keyEvery = Math.max(1, Math.round(fps * 2));
    try {
      for (let i = 0; i < n; i++) {
        if (exporting.cancelled) throw new Error('przerwano');
        if (venc?.error) throw venc.error;
        const t = rng.in + i / fps;
        if (feeder) await feeder.prepare(t);
        await renderFrameAt(t);
        if (encoder) {
          const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: dur });
          encoder.encode(vf, { keyFrame: i % keyEvery === 0 });
          vf.close();
          // czekamy na zwolnienie kolejki zdarzeniem, nie odpytywaniem (setTimeout ma 4 ms opóźnienia)
          while (encoder.encodeQueueSize > 6) await new Promise(r => encoder.addEventListener('dequeue', r, { once: true }));
        } else await vSrc.add(i / fps, 1 / fps);
        // dźwięk dokładany na bieżąco co sekundę, żeby muxer przeplatał ścieżki
        if (mix && (i + 1) / fps >= audioAt + 1) { const s = sliceOf(audioAt, audioAt + 1); if (s) await aSrc.add(s); audioAt += 1; }
        if (i % 5 === 0) { progress(i / n * 0.98, `⚡ Klatka ${i + 1} z ${n}${etaText(exporting.t0, i / n)}`); updatePlayheadUI(); }
      }
      if (encoder) {
        await encoder.flush();
        await venc.chain;
        if (venc.error) throw venc.error;
      }
      if (mix) { const s = sliceOf(audioAt, mix.duration); if (s) await aSrc.add(s); }
    } finally {
      feeder?.dispose();
      if (encoder && encoder.state !== 'closed') encoder.close();
    }
  } else if (mix) {
    progress(0.4, 'Kodowanie dźwięku…');
    await aSrc.add(mix);
  }
  progress(0.99, 'Zapisywanie pliku…');
  await output.finalize();
  return new Blob([output.target.buffer], { type: output.format.mimeType });
}

/* Miks dźwięku liczony poza czasem rzeczywistym */
const decoded = new Map();
async function decodedBuffer(mediaId) {
  if (decoded.has(mediaId)) return decoded.get(mediaId);
  const m = media.get(mediaId);
  const p = m?.blob ? m.blob.arrayBuffer().then(ab => ensureAudio().decodeAudioData(ab)).catch(() => null) : Promise.resolve(null);
  decoded.set(mediaId, p);
  return p;
}
/* Głośność zintegrowana (LUFS, ITU-R BS.1770): filtr K, bloki 400 ms, bramka −70 LUFS i względna −10 LU */
async function measureLufs(buf) {
  const oac = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const src = oac.createBufferSource();
  src.buffer = buf;
  const shelf = oac.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4;
  const hp = oac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(oac.destination);
  src.start();
  const k = await oac.startRendering();
  const hop = Math.round(0.1 * k.sampleRate), nh = Math.floor(k.length / hop);
  const chs = [...Array(k.numberOfChannels)].map((_, i) => k.getChannelData(i));
  const hs = new Float64Array(nh);
  for (let h = 0; h < nh; h++) { let e = 0; for (const d of chs) for (let i = h * hop, z = i + hop; i < z; i++) e += d[i] * d[i]; hs[h] = e; }
  const blocks = [];
  for (let h = 0; h + 4 <= nh; h++) blocks.push((hs[h] + hs[h + 1] + hs[h + 2] + hs[h + 3]) / (4 * hop));
  const L = z => -0.691 + 10 * Math.log10(z);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const abs = blocks.filter(z => z > 0 && L(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(mean(abs)) - 10;
  const gated = abs.filter(z => L(z) > rel);
  return L(mean(gated.length ? gated : abs));
}
/* Wyrównanie do docelowej głośności; szczyty miękko ograniczone do −1 dBFS, żeby podgłośnienie nie przesterowało */
async function loudnessNormalize(buf, target) {
  const lufs = await measureLufs(buf);
  if (!isFinite(lufs)) return { lufs, gainDb: 0 };
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) { const a = Math.abs(v); if (a > peak) peak = a; }
  const C = 0.891, T = 0.75; // sufit −1 dBFS, od 0,75 łagodne zaokrąglanie
  let gainDb = target - lufs;
  const room = 20 * Math.log10(C / Math.max(peak, 1e-6));
  const limited = gainDb > room + 6;
  if (limited) gainDb = room + 6; // więcej niż 6 dB ponad szczyt zniekształciłoby dźwięk
  const g = Math.pow(10, gainDb / 20);
  const clip = peak * g > C; // ogranicznik tylko wtedy, gdy po wzmocnieniu szczyty przekroczyłyby −1 dBFS
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i] * g, a = Math.abs(x);
      d[i] = !clip || a <= T ? x : Math.sign(x) * (T + (C - T) * Math.tanh((a - T) / (C - T)));
    }
  }
  return { lufs, gainDb, limited };
}
async function exportMix(from, to) {
  const mix = await renderAudioMix(from, to);
  const target = +($('#expLoud')?.value || 0);
  if (!target || !mix) return mix;
  const r = await loudnessNormalize(mix, target);
  const f1 = v => v.toFixed(1).replace('.', ',').replace('-', '−');
  if (isFinite(r.lufs)) toast(`Głośność: ${f1(r.lufs)} → ${r.limited ? 'ok. ' + f1(r.lufs + r.gainDb) : f1(target)} LUFS${r.limited ? ' (ograniczone, żeby nie przesterować)' : ''}`, 6000);
  return mix;
}
async function renderAudioMix(from, to, sr = 48000) {
  const len = Math.max(1, Math.ceil((to - from) * sr));
  const oac = new OfflineAudioContext(2, len, sr);
  const tails = computeTails();
  // szyny ścieżek jak w podglądzie: głośność + panorama, na końcu limiter
  const lim = createLimiter(oac);
  lim.out.connect(oac.destination);
  const trackIn = new Map();
  for (const tr of state.tracks) {
    if (!isAudible(tr)) continue;
    const g = oac.createGain(); g.gain.value = tr.vol ?? 1;
    const p = oac.createStereoPanner(); p.pan.value = clamp(tr.pan ?? 0, -1, 1);
    g.connect(p).connect(lim);
    trackIn.set(tr.id, g);
  }
  for (const c of state.clips) {
    if (!isAV(c) || c.off || !media.has(c.mediaId)) continue;
    if (c.kind === 'video' && c.props.detached) continue;
    if (!trackAudible(trackOf(c))) continue;
    const tail = tails.get(c.id) || 0;
    const a = Math.max(c.start, from), b = Math.min(clipEnd(c) + tail, to);
    if (b <= a) continue;
    // wstecz: odwrócona kopia dźwięku, czytana od miejsca odpowiadającego początkowi fragmentu
    const rev = c.speed < 0, s = Math.abs(c.speed);
    const buf = rev ? await reversedBufferAsync(c.mediaId) : await decodedBuffer(c.mediaId);
    if (!buf) continue;
    const pos = c.in + (a - c.start) * c.speed;
    const offset = Math.max(0, rev ? buf.duration - pos : pos);
    if (offset >= buf.duration) continue;
    const src = oac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = s;
    const g = oac.createGain();
    const gainAt = t => audioGain(c, t, t >= clipEnd(c) ? tail : 0);
    g.gain.setValueAtTime(gainAt(a), a - from);
    for (let t = a + 0.02; t < b; t += 0.02) g.gain.linearRampToValueAtTime(gainAt(t), t - from);
    const fx = buildAudioFx(oac, c.props.afx);
    src.connect(fx.input);
    fx.output.connect(g).connect(trackIn.get(c.trackId) || lim);
    src.start(a - from, offset, Math.min((b - a) * s, buf.duration - offset));
  }
  return oac.startRendering();
}
function encodeWav(buf, bits = 16) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const bps = bits / 8, fmt = bits === 32 ? 3 : 1;
  const data = new ArrayBuffer(44 + n * ch * bps);
  const v = new DataView(data);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bps, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, fmt, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, n * ch * bps, true);
  const chans = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = clamp(chans[c][i], -1, 1);
    if (bits === 16) { v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    else if (bits === 24) { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); o += 3; }
    else { v.setFloat32(o, s, true); o += 4; }
  }
  return new Blob([data], { type: 'audio/wav' });
}

/* ---------------- Kodery obrazów ---------------- */
function frameRGBA() { return ctx.getImageData(0, 0, canvas.width, canvas.height); }
function encodeBMP(img) {
  const { width: w, height: h, data } = img;
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h;
  const buf = new ArrayBuffer(size), v = new DataView(buf), u = new Uint8Array(buf);
  u[0] = 66; u[1] = 77; v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row, i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) { u[o++] = data[i + 2]; u[o++] = data[i + 1]; u[o++] = data[i]; }
  }
  return new Blob([buf], { type: 'image/bmp' });
}
function encodeTIFF(img) {
  const { width: w, height: h, data } = img;
  const pix = w * h * 3, ifdOff = 8, entries = 12, ifdSize = 2 + entries * 12 + 4;
  const bpsOff = ifdOff + ifdSize, resOff = bpsOff + 6, dataOff = resOff + 16;
  const buf = new ArrayBuffer(dataOff + pix), v = new DataView(buf), u = new Uint8Array(buf);
  u[0] = 73; u[1] = 73; v.setUint16(2, 42, true); v.setUint32(4, ifdOff, true);
  v.setUint16(ifdOff, entries, true);
  let e = ifdOff + 2;
  const tag = (t, type, count, val) => { v.setUint16(e, t, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true); if (type === 3 && count === 1) v.setUint16(e + 8, val, true); else v.setUint32(e + 8, val, true); e += 12; };
  tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 3, bpsOff); tag(259, 3, 1, 1); tag(262, 3, 1, 2); tag(273, 4, 1, dataOff);
  tag(277, 3, 1, 3); tag(278, 4, 1, h); tag(279, 4, 1, pix); tag(282, 5, 1, resOff); tag(283, 5, 1, resOff + 8); tag(296, 3, 1, 2);
  v.setUint32(e, 0, true);
  v.setUint16(bpsOff, 8, true); v.setUint16(bpsOff + 2, 8, true); v.setUint16(bpsOff + 4, 8, true);
  v.setUint32(resOff, 300, true); v.setUint32(resOff + 4, 1, true); v.setUint32(resOff + 8, 300, true); v.setUint32(resOff + 12, 1, true);
  for (let i = 0, o = dataOff; i < data.length; i += 4) { u[o++] = data[i]; u[o++] = data[i + 1]; u[o++] = data[i + 2]; }
  return new Blob([buf], { type: 'image/tiff' });
}
async function encodeICO() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const k = Math.max(256 / canvas.width, 256 / canvas.height);
  g.drawImage(canvas, (256 - canvas.width * k) / 2, (256 - canvas.height * k) / 2, canvas.width * k, canvas.height * k);
  const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
  const head = new ArrayBuffer(22), v = new DataView(head);
  v.setUint16(2, 1, true); v.setUint16(4, 1, true);
  v.setUint8(6, 0); v.setUint8(7, 0); v.setUint16(10, 1, true); v.setUint16(12, 32, true);
  v.setUint32(14, png.length, true); v.setUint32(18, 22, true);
  return new Blob([head, png], { type: 'image/x-icon' });
}

/* ---------------- GIF ---------------- */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
const GIF_PALETTE = (() => {
  const p = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) { p[i++] = Math.round(r * 51); p[i++] = Math.round(g * 42.5); p[i++] = Math.round(b * 51); }
  return p; // 252 kolory + 4 puste
})();
function quantize({ width: w, height: h, data }) {
  const out = new Uint8Array(w * h);
  for (let y = 0, i = 0, j = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4, j++) {
    const d = BAYER[(y & 3) * 4 + (x & 3)];
    const r = clamp(Math.round(data[i] / 51 + d), 0, 5), g = clamp(Math.round(data[i + 1] / 42.5 + d), 0, 6), b = clamp(Math.round(data[i + 2] / 51 + d), 0, 5);
    out[j] = r * 42 + g * 6 + b;
  }
  return out;
}
function lzwEncode(px, minCode = 8) {
  const clearCode = 1 << minCode, eof = clearCode + 1, initBits = minCode + 1;
  let nBits = initBits, maxcode = (1 << nBits) - 1, freeEnt = clearCode + 2, clearFlg = false;
  const out = [];
  let acc = 0, bits = 0;
  const dict = new Map();
  const output = code => {
    acc |= code << bits; bits += nBits;
    while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; }
    if (freeEnt > maxcode || clearFlg) {
      if (clearFlg) { nBits = initBits; maxcode = (1 << nBits) - 1; clearFlg = false; }
      else { nBits++; maxcode = nBits === 12 ? 4096 : (1 << nBits) - 1; }
    }
  };
  output(clearCode);
  let ent = px[0];
  for (let i = 1; i < px.length; i++) {
    const c = px[i], key = (c << 12) + ent, f = dict.get(key);
    if (f !== undefined) { ent = f; continue; }
    output(ent);
    ent = c;
    if (freeEnt < 4096) dict.set(key, freeEnt++);
    else { dict.clear(); freeEnt = clearCode + 2; clearFlg = true; output(clearCode); }
  }
  output(ent);
  output(eof);
  if (bits > 0) out.push(acc & 255);
  return out;
}
class GifWriter {
  constructor(w, h) {
    this.parts = [];
    const head = [71, 73, 70, 56, 57, 97, w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0];
    this.parts.push(new Uint8Array(head), GIF_PALETTE);
    this.parts.push(new Uint8Array([0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0]));
    this.w = w; this.h = h;
  }
  addFrame(img, delayCs) {
    const { w, h } = this;
    this.parts.push(new Uint8Array([0x21, 0xf9, 4, 0, delayCs & 255, delayCs >> 8, 0, 0, 0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8]));
    const data = lzwEncode(quantize(img));
    const blocks = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
    let o = 0;
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      blocks[o++] = n;
      for (let k = 0; k < n; k++) blocks[o++] = data[i + k];
    }
    blocks[o++] = 0;
    this.parts.push(blocks.subarray(0, o));
  }
  finish() { this.parts.push(new Uint8Array([0x3b])); return new Blob(this.parts, { type: 'image/gif' }); }
}

/* ---------------- ZIP (bez kompresji) ---------------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC_TABLE[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
class ZipWriter {
  constructor() { this.parts = []; this.central = []; this.offset = 0; }
  add(name, u8) {
    const nm = new TextEncoder().encode(name), crc = crc32(u8);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, u8.length, true); h.setUint32(22, u8.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, u8.length, true); c.setUint32(24, u8.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, this.offset, true);
    this.parts.push(h.buffer, nm, u8);
    this.central.push(c.buffer, nm);
    this.offset += 30 + nm.length + u8.length;
    this.count = (this.count || 0) + 1;
  }
  finish() {
    const size = this.central.reduce((a, p) => a + (p.byteLength ?? p.length), 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.count, true); e.setUint16(10, this.count, true);
    e.setUint32(12, size, true); e.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, e.buffer], { type: 'application/zip' });
  }
}

/* ---------------- AVI (Motion JPEG + PCM) ---------------- */
function buildAvi(frames, w, h, fps, pcm) {
  const fourcc = s => [...s].map(c => c.charCodeAt(0));
  const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const u16 = n => [n & 255, (n >> 8) & 255];
  const chunk = (id, bytes) => [...fourcc(id), ...u32(bytes.length), ...bytes, ...(bytes.length & 1 ? [0] : [])];
  const list = (type, inner) => [...fourcc('LIST'), ...u32(inner.length + 4), ...fourcc(type), ...inner];
  const scale = 1000, rate = Math.round(fps * 1000);
  const maxFrame = frames.reduce((m, f) => Math.max(m, f.length), 0);
  const audioPerFrame = pcm ? Math.ceil(pcm.length / frames.length) : 0;
  const avih = [...u32(Math.round(1e6 / fps)), ...u32(Math.round((maxFrame + audioPerFrame) * fps)), ...u32(0), ...u32(0x10), ...u32(frames.length), ...u32(0), ...u32(pcm ? 2 : 1), ...u32(maxFrame), ...u32(w), ...u32(h), ...u32(0), ...u32(0), ...u32(0), ...u32(0)];
  const vstrh = [...fourcc('vids'), ...fourcc('MJPG'), ...u32(0), ...u16(0), ...u16(0), ...u32(0), ...u32(scale), ...u32(rate), ...u32(0), ...u32(frames.length), ...u32(maxFrame), ...u32(0xffffffff), ...u32(0), ...u16(0), ...u16(0), ...u16(w), ...u16(h)];
  const vstrf = [...u32(40), ...u32(w), ...u32(h), ...u16(1), ...u16(24), ...fourcc('MJPG'), ...u32(w * h * 3), ...u32(0), ...u32(0), ...u32(0), ...u32(0)];
  let hdrl = [...chunk('avih', avih), ...list('strl', [...chunk('strh', vstrh), ...chunk('strf', vstrf)])];
  if (pcm) {
    const sr = 48000, block = 4;
    const astrh = [...fourcc('auds'), ...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u32(0), ...u32(block), ...u32(sr * block), ...u32(0), ...u32(pcm.length / block), ...u32(audioPerFrame), ...u32(0xffffffff), ...u32(block), ...u16(0), ...u16(0), ...u16(0), ...u16(0)];
    const astrf = [...u16(1), ...u16(2), ...u32(sr), ...u32(sr * block), ...u16(block), ...u16(16)];
    hdrl = [...hdrl, ...list('strl', [...chunk('strh', astrh), ...chunk('strf', astrf)])];
  }
  const hdrlList = new Uint8Array(list('hdrl', hdrl));
  // ramki i indeks
  const parts = [], idx = [];
  let moviSize = 4, off = 4;
  const per = pcm ? Math.floor(pcm.length / frames.length / 4) * 4 : 0;
  frames.forEach((f, i) => {
    const pad = f.length & 1;
    parts.push(new Uint8Array([...fourcc('00dc'), ...u32(f.length)]), f, ...(pad ? [new Uint8Array([0])] : []));
    idx.push([...fourcc('00dc'), ...u32(0x10), ...u32(off), ...u32(f.length)]);
    off += 8 + f.length + pad;
    if (pcm) {
      const end = i === frames.length - 1 ? pcm.length : (i + 1) * per;
      const a = pcm.subarray(i * per, end);
      parts.push(new Uint8Array([...fourcc('01wb'), ...u32(a.length)]), a, ...(a.length & 1 ? [new Uint8Array([0])] : []));
      idx.push([...fourcc('01wb'), ...u32(0x10), ...u32(off), ...u32(a.length)]);
      off += 8 + a.length + (a.length & 1);
    }
  });
  moviSize = off;
  const moviHead = new Uint8Array([...fourcc('LIST'), ...u32(moviSize), ...fourcc('movi')]);
  const idxBody = new Uint8Array(idx.flat());
  const idxHead = new Uint8Array([...fourcc('idx1'), ...u32(idxBody.length)]);
  const total = 4 + hdrlList.length + moviHead.length - 4 + moviSize + idxHead.length + idxBody.length;
  const riff = new Uint8Array([...fourcc('RIFF'), ...u32(total), ...fourcc('AVI ')]);
  return new Blob([riff, hdrlList, moviHead, ...parts, idxHead, idxBody], { type: 'video/x-msvideo' });
}
function pcm16(buf) {
  const n = buf.length, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const out = new Uint8Array(n * 4), v = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const l = clamp(L[i], -1, 1), r = clamp(R[i], -1, 1);
    v.setInt16(i * 4, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    v.setInt16(i * 4 + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
  }
  return out;
}

/* =========================================================
   Uruchomienie eksportu
   ========================================================= */
$('#expStart').addEventListener('click', async () => {
  const f = FMT_BY_ID.get($('#expFmt').value);
  const mime = formatMime(f);
  if (!mime) return;
  const kind = kindOfFormat(f);
  const rng = exportRange();
  const fps = +$('#expFps').value || state.fps;
  const comp = +$('#expComp').value;
  const qual = $('#expQuality').value;
  pause();
  setMonitor('program');
  sel.clear(); renderLanes(); renderInspector();
  setExpForm(false);
  $('#expCancel').textContent = 'Przerwij';
  $('#expProgress').hidden = false;
  progress(0, 'Przygotowanie…');
  const prevHead = playhead;
  exporting = { cancelled: false, from: rng.in, to: rng.out, t0: performance.now(), prevLoop: loopOn, offline: mime === 'fast' || (f.type !== 'rec' && f.type !== 'arec') };
  loopOn = false;
  try {
    if (mime === 'fast') {
      const blob = await fastExport(f, rng, fps, comp, qual);
      const secs = (performance.now() - exporting.t0) / 1000;
      finishWith(blob, exportName(f.ext));
      $('#expStatus').textContent += ` Czas eksportu ${shortDur(secs)} przy filmie ${shortDur(rng.out - rng.in)} (${(Math.max(0.01, rng.out - rng.in) / Math.max(0.01, secs)).toFixed(1).replace('.', ',')}× szybciej niż odtwarzanie).`;
      endExport(prevHead);
      return;
    }
    if (f.type === 'rec' || f.type === 'arec') { await startRecording(f, mime, kind, rng, fps, comp, qual); return; }
    if (f.type === 'image') {
      setExportCanvas(f.enc === 'ico' ? Math.max(256 / state.w, 256 / state.h) : +qual);
      await renderFrameAt(prevHead);
      let blob;
      if (f.enc === 'bmp') blob = encodeBMP(frameRGBA());
      else if (f.enc === 'tiff') blob = encodeTIFF(frameRGBA());
      else if (f.enc === 'ico') blob = await encodeICO();
      else if (f.enc === 'gif') { const g = new GifWriter(canvas.width, canvas.height); g.addFrame(frameRGBA(), 0); blob = g.finish(); }
      else blob = await new Promise(r => canvas.toBlob(r, f.mime, COMP.q[comp]));
      finishWith(blob, `${safeName($('#projName').value)} ${tc(prevHead).replace(/:/g, '-')}.${f.ext}`);
    } else if (f.type === 'wav') {
      progress(0.1, 'Liczenie dźwięku…');
      const buf = await exportMix(rng.in, rng.out);
      if (exporting.cancelled) throw new Error('przerwano');
      finishWith(encodeWav(buf, +qual), exportName('wav'));
    } else {
      // klatka po klatce: GIF, AVI, sekwencje
      const { W, H } = setExportCanvas(+qual);
      const n = Math.max(1, Math.round((rng.out - rng.in) * fps));
      const gif = f.type === 'gif' ? new GifWriter(W, H) : null;
      const zip = f.type === 'seq' ? new ZipWriter() : null;
      const frames = f.type === 'avi' ? [] : null;
      const digits = String(n).length;
      const feeder = await makeFeeder();
      exporting.feeder = feeder;
      for (let i = 0; i < n; i++) {
        if (exporting.cancelled) { feeder?.dispose(); throw new Error('przerwano'); }
        if (feeder) await feeder.prepare(rng.in + i / fps);
        await renderFrameAt(rng.in + i / fps);
        if (gif) gif.addFrame(frameRGBA(), Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps));
        else {
          const mt = f.type === 'avi' ? 'image/jpeg' : f.mime;
          const blob = await new Promise(r => canvas.toBlob(r, mt, COMP.q[comp]));
          const u8 = new Uint8Array(await blob.arrayBuffer());
          if (zip) zip.add(`klatka_${String(i + 1).padStart(Math.max(4, digits), '0')}.${f.fext}`, u8);
          else frames.push(u8);
        }
        if (i % 3 === 0) { progress(i / n * (f.type === 'avi' ? 0.9 : 1), `Klatka ${i + 1} z ${n}${etaText(exporting.t0, i / n)}`); updatePlayheadUI(); await sleep(0); }
      }
      feeder?.dispose();
      let blob;
      if (gif) blob = gif.finish();
      else if (zip) blob = zip.finish();
      else {
        progress(0.92, 'Liczenie dźwięku…');
        const audio = await exportMix(rng.in, rng.out);
        blob = buildAvi(frames, W, H, fps, pcm16(audio));
      }
      finishWith(blob, exportName(f.ext));
    }
  } catch (err) {
    try { await exporting?.output?.cancel(); } catch { /* już zamknięte */ }
    exporting?.feeder?.dispose();
    progress(0, exporting?.cancelled ? 'Eksport przerwany.' : 'Nie udało się wyeksportować: ' + err.message);
    if (!exporting?.cancelled) console.error(err);
  }
  endExport(prevHead);
});

function endExport(prevHead) {
  if (typeof ytPending !== 'undefined') ytPending = null; // przerwany eksport nie wysyła niczego przy następnym
  const ex = exporting;
  exporting = null;
  if (ex) loopOn = ex.prevLoop;
  restorePreview();
  if (prevHead !== undefined) seek(prevHead);
  $('#expCancel').textContent = 'Zamknij';
  setExpForm(true);
}

/* Nagrywanie na żywo przez MediaRecorder (wideo albo sam dźwięk) */
async function startRecording(f, mime, kind, rng, fps, comp, qual) {
  await ensureAudio().resume();
  const stream = new MediaStream();
  let vtrack = null;
  if (kind === 'video') {
    setExportCanvas(+qual);
    vtrack = canvas.captureStream(fps).getVideoTracks()[0];
    stream.addTrack(vtrack);
  }
  exportDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const opts = { mimeType: mime };
  if (kind === 'video') { opts.videoBitsPerSecond = Math.round(canvas.width * canvas.height * fps * COMP.bpp[comp]); opts.audioBitsPerSecond = 256000; }
  else opts.audioBitsPerSecond = +qual;
  let rec;
  try { rec = new MediaRecorder(stream, opts); }
  catch (err) { vtrack?.stop(); throw new Error('przeglądarka nie uruchomiła nagrywania (' + err.message + ')'); }
  const chunks = [];
  rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
  const prevHead = playhead;
  Object.assign(exporting, { rec, vtrack, live: true });
  rec.onstop = () => {
    vtrack?.stop();
    const ex = exporting;
    if (!ex) return;
    if (!ex.cancelled) {
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      finishWith(blob, exportName(f.ext));
    } else progress(0, 'Eksport przerwany.');
    endExport(prevHead);
  };
  seek(rng.in);
  await sleep(700);
  if (!exporting || exporting.cancelled) { endExport(prevHead); return; }
  rec.start(500);
  exporting.t0 = performance.now();
  play();
}
// wywoływane przez pętlę odtwarzania (render.js)
function updateExportProgress() {
  const ex = exporting;
  const p = clamp((playhead - ex.from) / (ex.to - ex.from), 0, 1);
  progress(p, `Nagrywanie… ${Math.round(p * 100)}%${etaText(ex.t0, p)}`);
}
function finishExport() {
  playing = false;
  rate = 1;
  document.body.classList.remove('is-playing');
  for (const p of players.values()) { p.el.pause(); p.gain.gain.value = 0; }
  drawFrame();
  updatePlayheadUI();
  setTimeout(() => { if (exporting?.rec && exporting.rec.state !== 'inactive') exporting.rec.stop(); }, 200);
}
function cancelExport() {
  if (!exporting) return;
  exporting.cancelled = true;
  if (exporting.live) {
    pause();
    if (exporting.rec?.state !== 'inactive') exporting.rec.stop();
  }
}
$('#expCancel').addEventListener('click', () => { if (exporting) cancelExport(); else expDlg.close(); });
expDlg.addEventListener('cancel', e => { if (exporting) e.preventDefault(); });
