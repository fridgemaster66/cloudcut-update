'use strict';
/* ai.js — narzędzia AI w zakładce „Assety”: usuwanie tła (model na Twoim komputerze), lektor (głos Windows)
   i skróty do inteligentnych narzędzi (napisy AI, cisza, sceny, rytm, ściszanie pod głosem, głośność) */

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

function runAiTool(id) {
  const tools = {
    bg: openBgRemove, tts: openTts, captions: openCaptions, silence: removeSilence,
    scenes: detectScenes, beats: detectBeats, duck: autoDuck, loud: normalizeAll,
  };
  const fn = tools[id];
  if (fn) fn();
}

/* Wspólny pasek postępu w oknach AI */
function aiProgress(dlg) {
  const box = dlg.querySelector('.progress'), bar = dlg.querySelector('.progress .bar'), st = dlg.querySelector('.ai-status');
  return (p, msg) => {
    if (p !== null) { box.hidden = false; bar.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%'; }
    if (msg !== undefined) st.textContent = msg;
  };
}

/* =========================================================
   Usuń tło (AI): obraz albo bieżąca klatka filmu → PNG z przezroczystym tłem
   ========================================================= */
const BG_MODELS = [
  { id: 'Xenova/modnet', name: 'Osoba — szybko (ok. 25 MB)', dtype: 'fp32', gpu: false },
  { id: 'onnx-community/BiRefNet_lite-ONNX', name: 'Dowolny obiekt — dokładniej (ok. 110–210 MB)', dtype: 'fp32', gpu: true },
];
let bgDlg = null, bgPipe = null, bgPipeId = null;
/* Co wycinamy: zaznaczony obraz/film pod głowicą, a bez zaznaczenia — najwyższy widoczny pod głowicą */
function bgSource() {
  const t = playhead, at = c => !c.off && (c.kind === 'image' || c.kind === 'video') && t >= c.start && t < clipEnd(c) && media.has(c.mediaId);
  let c = selectedClips().find(at);
  if (!c) for (const tr of state.tracks) { if (tr.kind !== 'video' || tr.hidden) continue; c = clipsOn(tr.id).find(at); if (c) break; }
  return c || null;
}
function openBgRemove() {
  if (!bgDlg) {
    bgDlg = document.createElement('dialog');
    bgDlg.className = 'dlg';
    bgDlg.setAttribute('aria-labelledby', 'bgTitle');
    bgDlg.innerHTML = `<h2 id="bgTitle">Usuń tło (AI)</h2>
      <p class="hint">Model działa na Twoim komputerze — obraz nie jest nigdzie wysyłany. Za pierwszym razem pobierze się model (raz, potem jest w pamięci programu).</p>
      <p class="ai-src" id="bgSrc"></p>
      <div class="field"><label for="bgModel">Co jest na pierwszym planie?</label><select id="bgModel">${BG_MODELS.map((m, i) => `<option value="${i}">${m.name}</option>`).join('')}</select></div>
      <div class="progress" hidden><div class="bar"></div></div>
      <p class="hint ai-status" aria-live="polite"></p>
      <div class="dlg-actions"><button type="button" class="btn" id="bgClose">Zamknij</button><button type="button" class="btn primary" id="bgStart">Usuń tło</button></div>`;
    document.body.appendChild(bgDlg);
    bgDlg.querySelector('#bgClose').addEventListener('click', () => bgDlg.close());
    bgDlg.querySelector('#bgStart').addEventListener('click', runBgRemove);
  }
  const c = bgSource();
  bgDlg.querySelector('#bgSrc').textContent = !c ? 'Ustaw głowicę na zdjęciu albo filmie (albo je zaznacz) — z niego zostanie wycięty pierwszy plan.'
    : c.kind === 'image' ? `Obraz: „${clipLabel(c)}” — tło zniknie z tego klipu.` : `Klatka filmu „${clipLabel(c)}” w miejscu głowicy (${tc(playhead)}) — wycięta postać trafi na ścieżkę wyżej jako obraz.`;
  bgDlg.querySelector('#bgStart').disabled = !c;
  bgDlg.querySelector('.progress').hidden = true;
  bgDlg.querySelector('.ai-status').textContent = '';
  bgDlg.showModal();
}
async function loadBgPipe(model, set) {
  if (bgPipe && bgPipeId === model.id) return bgPipe;
  set(0.03, 'Wczytywanie biblioteki AI…');
  const tf = await import(TRANSFORMERS_URL);
  const files = new Map();
  const progress_callback = p => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    const [l, t] = [...files.values()].reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
    set(0.05 + 0.6 * l / t, `Pobieranie modelu: ${(l / 1048576).toFixed(0)} z ${(t / 1048576).toFixed(0)} MB`);
  };
  let pipe = null;
  // duży model liczy się szybciej na karcie graficznej (WebGPU); bez niej — na procesorze
  if (model.gpu && navigator.gpu) {
    try { pipe = await tf.pipeline('background-removal', model.id, { device: 'webgpu', dtype: 'fp16', progress_callback }); }
    catch (err) { console.warn('WebGPU niedostępne, liczę na procesorze', err); pipe = null; }
  }
  pipe ||= await tf.pipeline('background-removal', model.id, { device: 'wasm', dtype: model.dtype, progress_callback });
  bgPipe = pipe; bgPipeId = model.id;
  bgPipe.tf = tf;
  return pipe;
}
async function runBgRemove() {
  const set = aiProgress(bgDlg), btn = bgDlg.querySelector('#bgStart');
  const c = bgSource();
  if (!c) return;
  btn.disabled = true;
  try {
    const t = playhead;
    const model = BG_MODELS[+bgDlg.querySelector('#bgModel').value];
    const pipe = await loadBgPipe(model, set);
    set(0.7, 'Przygotowanie obrazu…');
    let cv;
    if (c.kind === 'image') {
      const m = media.get(c.mediaId);
      cv = document.createElement('canvas');
      cv.width = m.w; cv.height = m.h;
      cv.getContext('2d').drawImage(m.img, 0, 0);
    } else cv = await frameCanvas(c, t);
    set(0.75, 'Wycinanie pierwszego planu…');
    const out = await pipe(pipe.tf.RawImage.fromCanvas(cv));
    const img = Array.isArray(out) ? out[0] : out;
    const blob = await img.toBlob('image/png');
    set(0.95, 'Zapisywanie…');
    const base = clipLabel(c).replace(/\.[a-z0-9]{2,4}$/i, '');
    const m2 = await importBlob(blob, `${base} — bez tła.png`);
    if (!m2) throw new Error('nie udało się zapisać wyniku');
    if (c.kind === 'image' && clipById(c.id)) {
      c.mediaId = m2.id;
      c.name = m2.name;
      sel = new Set([c.id]);
    } else {
      // wycięta postać nad filmem, w tym samym miejscu kadru
      const idx = state.tracks.findIndex(tr => tr.id === c.trackId);
      const dur = Math.min(3, Math.max(frame(), clipEnd(c) - t));
      let tr = state.tracks.slice(0, idx).reverse().find(x => x.kind === 'video' && !x.locked && !overlaps(x.id, t, t + dur));
      tr ||= addTrack('video', false);
      const ic = newClip('image', tr.id, t, dur, { mediaId: m2.id, name: m2.name });
      for (const k of ['x', 'y', 'scale', 'rotation', 'fit', 'flipH', 'flipV', 'crop']) ic.props[k] = structuredClone(c.props[k]);
      state.clips.push(ic);
      sel = new Set([ic.id]);
    }
    commit(); renderAll(); renderBin();
    set(1, c.kind === 'image' ? 'Gotowe — tło zniknęło z obrazu (oryginał został w Mediach).' : 'Gotowe — wycięta klatka leży na ścieżce nad filmem i jest w Mediach.');
  } catch (err) {
    console.error(err);
    set(null, 'Nie udało się usunąć tła: ' + (err?.message || err));
  } finally { btn.disabled = false; }
}

/* =========================================================
   Lektor: tekst → mowa głosem zainstalowanym w Windows, nagranie na ścieżkę audio
   ========================================================= */
let ttsDlg = null, ttsVoices = null, ttsAudio = null;
async function openTts() {
  if (!ttsDlg) {
    ttsDlg = document.createElement('dialog');
    ttsDlg.className = 'dlg';
    ttsDlg.setAttribute('aria-labelledby', 'ttsTitle');
    ttsDlg.innerHTML = `<h2 id="ttsTitle">Lektor — czytanie tekstu</h2>
      <p class="hint">Głos z systemu Windows, bez internetu. Gotowe nagranie trafi na ścieżkę audio w miejscu głowicy.</p>
      <div class="field"><label for="ttsText">Tekst do przeczytania</label><textarea id="ttsText" rows="6" maxlength="3000" placeholder="Np. Cześć, w dzisiejszym odcinku…"></textarea></div>
      <div class="row2">
        <div class="field"><label for="ttsVoice">Głos</label><select id="ttsVoice"><option value="">Wczytywanie…</option></select></div>
        <div class="field"><div class="lbl"><label for="ttsRate">Tempo</label><output id="ttsRateOut">normalne</output></div><input type="range" id="ttsRate" min="-5" max="5" step="1" value="0"></div>
      </div>
      <div class="progress" hidden><div class="bar"></div></div>
      <p class="hint ai-status" aria-live="polite"></p>
      <div class="dlg-actions"><button type="button" class="btn" id="ttsClose">Zamknij</button><button type="button" class="btn" id="ttsPlay">▶ Odsłuchaj</button><button type="button" class="btn primary" id="ttsInsert">Wstaw na oś</button></div>`;
    document.body.appendChild(ttsDlg);
    ttsDlg.querySelector('#ttsClose').addEventListener('click', () => ttsDlg.close());
    ttsDlg.addEventListener('close', () => { ttsAudio?.pause(); });
    ttsDlg.querySelector('#ttsRate').addEventListener('input', e => {
      const v = +e.target.value;
      ttsDlg.querySelector('#ttsRateOut').textContent = v === 0 ? 'normalne' : v < 0 ? `wolniej (${v})` : `szybciej (+${v})`;
    });
    ttsDlg.querySelector('#ttsPlay').addEventListener('click', () => runTts(false));
    ttsDlg.querySelector('#ttsInsert').addEventListener('click', () => runTts(true));
  }
  const tc0 = selectedClips().find(c => c.kind === 'text');
  if (tc0) ttsDlg.querySelector('#ttsText').value = tc0.props.text;
  ttsDlg.querySelector('.progress').hidden = true;
  ttsDlg.querySelector('.ai-status').textContent = '';
  ttsDlg.showModal();
  const sel_ = ttsDlg.querySelector('#ttsVoice');
  if (!ttsVoices) {
    try { ttsVoices = (await api('GET', 'ai/voices')).voices; }
    catch (err) { sel_.innerHTML = '<option value="">—</option>'; ttsDlg.querySelector('.ai-status').textContent = 'Lektor jest niedostępny: ' + err.message; return; }
  }
  // polskie głosy na początku
  const list = [...ttsVoices].sort((a, b) => (b.lang.startsWith('pl') - a.lang.startsWith('pl')) || a.name.localeCompare(b.name));
  sel_.innerHTML = list.length ? list.map(v => `<option value="${esc(v.name)}">${esc(v.name.replace(/^Microsoft /, '').replace(/ Desktop$/, ''))} (${esc(v.lang)})</option>`).join('')
    : '<option value="">Brak głosów w systemie</option>';
}
async function ttsWav() {
  const text = ttsDlg.querySelector('#ttsText').value.trim();
  if (!text) throw new Error('wpisz tekst do przeczytania');
  const r = await api('POST', 'ai/tts', { text, voice: ttsDlg.querySelector('#ttsVoice').value, rate: +ttsDlg.querySelector('#ttsRate').value });
  const bin = atob(r.audio), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: 'audio/wav' }), text };
}
async function runTts(insert) {
  const set = aiProgress(ttsDlg), btns = ttsDlg.querySelectorAll('#ttsPlay, #ttsInsert');
  btns.forEach(b => { b.disabled = true; });
  try {
    set(0.2, 'Czytanie tekstu…');
    const { blob, text } = await ttsWav();
    if (!insert) {
      ttsAudio?.pause();
      if (ttsAudio?.src) URL.revokeObjectURL(ttsAudio.src);
      ttsAudio = new Audio(URL.createObjectURL(blob));
      ttsAudio.play().catch(() => {});
      set(1, 'Odtwarzanie podglądu…');
      return;
    }
    set(0.7, 'Wstawianie na oś…');
    const words = text.replace(/\s+/g, ' ').split(' ').slice(0, 5).join(' ').replace(/[\\/:*?"<>|]/g, '').replace(/[.,!?;:…\s]+$/, '');
    const m = await importBlob(blob, `Lektor — ${words}.wav`);
    if (!m) throw new Error('nie udało się wczytać nagrania');
    const t = playhead;
    // wolna ścieżka audio w tym miejscu (nagranie niczego nie nadpisuje), a w ostateczności nowa
    const tr = state.tracks.find(x => x.kind === 'audio' && !x.locked && !overlaps(x.id, t, t + m.duration)) || addTrack('audio', false);
    placeMedia(m, { t, trackId: tr.id });
    set(1, `Gotowe — nagranie (${shortDur(m.duration)}) jest na ścieżce ${tr.name}.`);
  } catch (err) {
    set(null, 'Nie udało się: ' + err.message);
  } finally { btns.forEach(b => { b.disabled = false; }); }
}
