'use strict';
/* keys.js — rejestr poleceń, skróty klawiszowe (z możliwością zmiany) i ich edytor */

/* =========================================================
   Dodatkowe polecenia montażowe
   ========================================================= */
function nudge(d) {
  const s = selectedClips().filter(c => !isLocked(c));
  if (!s.length) { toast('Zaznacz klipy, które chcesz przesunąć'); return; }
  const ids = new Set(s.map(c => c.id));
  d = Math.max(d, -Math.min(...s.map(c => c.start)));
  if (!d) return;
  if (s.some(c => overlaps(c.trackId, c.start + d, clipEnd(c) + d, ids))) { toast('Przesunięcie blokuje sąsiedni klip'); return; }
  for (const c of s) c.start += d;
  commit(); renderLanes(); syncMedia(); drawFrame(); renderInspector();
}

function moveToTrack(dir) {
  const s = selectedClips().filter(c => !isLocked(c));
  if (!s.length) { toast('Zaznacz klipy, które chcesz przenieść'); return; }
  const ids = new Set(s.map(c => c.id));
  const plan = [];
  for (const c of s) {
    const kind = trackOf(c).kind;
    const list = state.tracks.filter(t => t.kind === kind && !t.locked);
    const target = list[list.findIndex(t => t.id === c.trackId) + dir];
    if (!target) { toast('Brak ścieżki ' + (dir < 0 ? 'wyżej' : 'niżej') + ' — dodaj ją przyciskiem „+ Ścieżka”'); return; }
    if (overlaps(target.id, c.start, clipEnd(c), ids)) { toast('Na ścieżce ' + target.name + ' jest już klip w tym miejscu'); return; }
    plan.push([c, target.id]);
  }
  for (const [c, id] of plan) c.trackId = id;
  commit(); renderAll();
}

function extendToPlayhead() {
  const t = playhead;
  const s = selectedClips().filter(c => !isLocked(c));
  if (!s.length) { toast('Zaznacz klip, którego krawędź chcesz dociągnąć do głowicy'); return; }
  for (const c of s) {
    const m = media.get(c.mediaId);
    const others = clipsOn(c.trackId).filter(o => o.id !== c.id);
    if (t > clipEnd(c)) {
      const next = others.find(o => o.start >= clipEnd(c) - EPS);
      let end = Math.min(t, next ? next.start : Infinity);
      if (isAV(c) && m) end = Math.min(end, clipEnd(c) + roomAfter(c, m));
      c.dur = Math.max(frame(), end - c.start);
    } else if (t < c.start) {
      const prevEnd = Math.max(0, ...others.filter(o => clipEnd(o) <= c.start + EPS).map(clipEnd));
      let ns = Math.max(t, prevEnd);
      if (isAV(c)) ns = Math.max(ns, c.start - roomBefore(c, m));
      trimStartTo(c, ns);
    } else {
      // głowica wewnątrz klipu: bliższa krawędź jest dociągana do głowicy
      if (t - c.start < clipEnd(c) - t) trimStartTo(c, t); else c.dur = t - c.start;
    }
  }
  commit(); renderAll();
}

function selectUnderPlayhead() {
  const t = playhead;
  sel = new Set(state.clips.filter(c => !isLocked(c) && t >= c.start && t < clipEnd(c)).map(c => c.id));
  if (!sel.size) toast('Pod głowicą nie ma klipów');
  renderLanes(); renderInspector(); drawFrame();
}
function deselectAll() { sel.clear(); renderLanes(); renderInspector(); drawFrame(); }
function selectAll() { sel = new Set(state.clips.filter(c => !isLocked(c)).map(c => c.id)); renderLanes(); renderInspector(); drawFrame(); }

function toggleClipsOff() {
  const s = selectedClips().filter(c => !isLocked(c));
  if (!s.length) { toast('Zaznacz klipy, które chcesz wyłączyć lub włączyć'); return; }
  const off = !s.every(c => c.off);
  for (const c of s) c.off = off;
  commit(); renderAll();
  toast(off ? 'Klipy wyłączone — nie widać ich i nie słychać' : 'Klipy włączone', 1800);
}

function addDefaultTransition() {
  let s = selectedClips().filter(c => !isLocked(c));
  if (!s.length) s = state.clips.filter(c => !isLocked(c) && Math.abs(c.start - playhead) < 3 * frame());
  if (!s.length) { toast('Zaznacz klip albo ustaw głowicę na cięciu'); return; }
  for (const c of s) {
    const prev = state.clips.find(p => p.trackId === c.trackId && p.id !== c.id && Math.abs(clipEnd(p) - c.start) < 0.002);
    c.props.inType = prev ? 'cross' : 'fade';
    c.props.fadeIn = Math.min(0.5, c.dur / 2);
  }
  commit(); renderAll();
  toast('Dodano przejście 0,5 s', 1500);
}

function volumeStep(db) {
  const targets = new Set();
  for (const c of selectedClips()) {
    if (c.kind === 'audio') targets.add(c);
    else if (c.kind === 'video') targets.add(c.props.detached ? groupMembers(c).find(x => x.kind === 'audio') || c : c);
  }
  if (!targets.size) { toast('Zaznacz klip z dźwiękiem'); return; }
  let last = 1;
  for (const c of targets) {
    const v = clamp(pv(c, 'volume', localAt(c)) * Math.pow(10, db / 20), 0, 4);
    setProp(c, 'volume', Math.round(v * 1000) / 1000);
    last = v;
  }
  commit(); renderInspector(); renderLanes();
  toast(`Głośność: ${last > 0 ? (20 * Math.log10(last)).toFixed(1).replace('.', ',') + ' dB' : 'wyciszona'}`, 1200);
}

function matchFrame() {
  const t = playhead;
  let c = selectedClips().find(x => x.mediaId && t >= x.start && t < clipEnd(x));
  c ||= state.tracks.filter(tr => !tr.hidden).flatMap(tr => clipsOn(tr.id)).find(x => isAV(x) && t >= x.start && t < clipEnd(x));
  if (!c || !isAV(c)) { toast('Pod głowicą nie ma klipu wideo ani audio'); return; }
  openSource(c.mediaId);
  srcVideo.currentTime = srcTimeOf(c, t);
}

function playAround() {
  const t0 = playhead;
  playAroundOrigin = t0;
  seek(Math.max(0, t0 - 2));
  playStopAt = t0 + 2;
  play();
}

function gotoMarker(dir) {
  const list = [...state.markers].sort((a, b) => a.t - b.t);
  const m = dir > 0 ? list.find(x => x.t > playhead + EPS) : list.reverse().find(x => x.t < playhead - EPS);
  if (m) seek(m.t); else toast(state.markers.length ? 'Brak kolejnych znaczników' : 'Nie ma znaczników — dodaj je klawiszem ' + keyLabel('marker'));
}

function pasteInsert() {
  if (!clipboard?.length) { toast('Schowek jest pusty'); return; }
  const span = Math.max(...clipboard.map(c => c._off + c.dur));
  rippleInsert(playhead, span);
  paste(playhead);
}

function clearRange_() { state.range = null; commit(); drawRuler(); renderHeads(); }
function gotoRange(which) { if (state.range) seek(state.range[which]); else toast('Nie ustawiono zakresu I–O'); }

function focusPanel(n) {
  const go = el => { el?.focus(); };
  if (n === 1) go($('.tabs [aria-selected="true"]'));
  else if (n === 2) { setMonitor('source'); go($('#srcTrack:not([hidden])') || $('#stage')); }
  else if (n === 3) go(scrollEl);
  else if (n === 4) { setMonitor('program'); go($('#stage')); }
  else if (n === 5) go($('#inspector').querySelector('input, select, textarea, button') || $('#inspector'));
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('#stage').requestFullscreen?.().catch(() => toast('Pełny ekran jest niedostępny'));
}

/* Monitor źródła */
const srcStep = d => { srcVideo.currentTime = clamp(srcVideo.currentTime + d, 0, srcVideo.duration || 0); };

/* =========================================================
   Rejestr poleceń
   g — grupa, keys — domyślne skróty, rep — działa przy przytrzymaniu,
   ctx: 'source' — tylko gdy aktywny jest monitor źródła
   ========================================================= */
const GROUPS = {
  play: { name: 'Odtwarzanie', color: '#6b95ff' },
  edit: { name: 'Montaż', color: '#ff9f43' },
  select: { name: 'Zaznaczanie', color: '#c38bff' },
  marks: { name: 'Znaczniki i zakres', color: '#5fd39b' },
  view: { name: 'Widok', color: '#4fd1e8' },
  file: { name: 'Pliki i projekt', color: '#f2c94c' },
  source: { name: 'Monitor źródła', color: '#ff7ab6' },
};

const COMMANDS = [
  // Odtwarzanie
  { id: 'play', g: 'play', label: 'Odtwórz / pauza', short: 'Odtwórz', keys: ['space'], run: togglePlay },
  { id: 'stop', g: 'play', label: 'Pauza', short: 'Pauza', keys: ['k'], run: () => pause() },
  { id: 'fwd', g: 'play', label: 'Do przodu (każde naciśnięcie szybciej)', short: 'Naprzód', keys: ['l'], run: () => setRate(!playing || rate < 0 ? 1 : Math.min(8, rate * 2)) },
  { id: 'back', g: 'play', label: 'Do tyłu (każde naciśnięcie szybciej)', short: 'Wstecz', keys: ['j'], run: () => setRate(!playing || rate > 0 ? -1 : Math.max(-8, rate * 2)) },
  { id: 'playAround', g: 'play', label: 'Odtwórz wokół głowicy (±2 s)', short: 'Wokół', keys: ['shift+k'], run: playAround },
  { id: 'frameBack', g: 'play', label: 'Klatka wstecz', short: '−1 kl.', keys: ['left'], rep: true, run: () => seek(playhead - frame()) },
  { id: 'frameFwd', g: 'play', label: 'Klatka naprzód', short: '+1 kl.', keys: ['right'], rep: true, run: () => seek(playhead + frame()) },
  { id: 'secBack', g: 'play', label: 'Sekunda wstecz', short: '−1 s', keys: ['shift+left'], rep: true, run: () => seek(playhead - 1) },
  { id: 'secFwd', g: 'play', label: 'Sekunda naprzód', short: '+1 s', keys: ['shift+right'], rep: true, run: () => seek(playhead + 1) },
  { id: 'prevEdit', g: 'play', label: 'Poprzednie cięcie', short: 'Poprz. cięcie', keys: ['up'], rep: true, run: () => jumpEdit(-1) },
  { id: 'nextEdit', g: 'play', label: 'Następne cięcie', short: 'Nast. cięcie', keys: ['down'], rep: true, run: () => jumpEdit(1) },
  { id: 'goStart', g: 'play', label: 'Na początek', short: 'Początek', keys: ['home'], run: () => seek(0) },
  { id: 'goEnd', g: 'play', label: 'Na koniec', short: 'Koniec', keys: ['end'], run: () => seek(projectEnd()) },
  { id: 'loop', g: 'play', label: 'Zapętlanie wł./wył.', short: 'Pętla', keys: ['ctrl+l'], run: () => toggleLoop() },

  // Montaż
  { id: 'split', g: 'edit', label: 'Przetnij w miejscu głowicy', short: 'Przetnij', keys: ['ctrl+b', 's'], run: () => splitAt(playhead) },
  { id: 'splitAll', g: 'edit', label: 'Przetnij wszystkie ścieżki w głowicy', short: 'Tnij wszystko', keys: ['ctrl+shift+b'], run: () => splitAt(playhead, state.clips.filter(c => !isLocked(c))) },
  { id: 'toolSelect', g: 'edit', label: 'Narzędzie: zaznaczanie', short: 'Zaznacz', keys: ['v'], run: () => setTool('select') },
  { id: 'toolBlade', g: 'edit', label: 'Narzędzie: żyletka', short: 'Żyletka', keys: ['c'], run: () => setTool('blade') },
  { id: 'toolRipple', g: 'edit', label: 'Narzędzie: przycinanie z zsunięciem (ripple)', short: 'Ripple', keys: ['b'], run: () => setTool('ripple') },
  { id: 'toolRoll', g: 'edit', label: 'Narzędzie: przesuwanie cięcia (roll)', short: 'Roll', keys: ['r'], run: () => setTool('roll') },
  { id: 'toolSlip', g: 'edit', label: 'Narzędzie: poślizg treści (slip)', short: 'Slip', keys: ['y'], run: () => setTool('slip') },
  { id: 'captions', g: 'edit', label: 'Automatyczne napisy (AI)', short: 'Napisy AI', keys: ['shift+c'], run: () => openCaptions() },
  { id: 'silence', g: 'edit', label: 'Usuń ciszę z zaznaczonego klipu', short: 'Usuń ciszę', keys: ['shift+s'], run: () => removeSilence() },
  { id: 'beats', g: 'marks', label: 'Wykryj rytm muzyki (znaczniki)', short: 'Rytm', keys: ['shift+b'], run: () => detectBeats() },
  { id: 'scenes', g: 'edit', label: 'Wykryj zmiany ujęć i potnij', short: 'Sceny', keys: ['ctrl+alt+d'], run: () => detectScenes() },
  { id: 'duck', g: 'edit', label: 'Ścisz muzykę pod głosem (ducking)', short: 'Ducking', keys: ['ctrl+alt+u'], run: () => autoDuck() },
  { id: 'mixer', g: 'view', label: 'Mikser audio', short: 'Mikser', keys: ['ctrl+alt+m'], run: () => openMixer() },
  { id: 'tabAssets', g: 'view', label: 'Biblioteka assetów', short: 'Assety', keys: ['shift+a'], run: () => { selectTab($('#tab-assets')); $('#assetSearch').focus(); } },
  { id: 'tabTrans', g: 'view', label: 'Biblioteka przejść', short: 'Przejścia', keys: ['shift+t'], run: () => { selectTab($('#tab-trans')); $('#transList .t-card')?.focus(); } },
  { id: 'delete', g: 'edit', label: 'Usuń zaznaczone', short: 'Usuń', keys: ['delete', 'backspace'], run: () => deleteSelected(false) },
  { id: 'rippleDelete', g: 'edit', label: 'Usuń z zsunięciem reszty', short: 'Usuń+zsuń', keys: ['shift+delete', 'shift+backspace'], run: () => deleteSelected(true) },
  { id: 'trimStart', g: 'edit', label: 'Przytnij początek do głowicy (z zsunięciem)', short: 'Przytnij pocz.', keys: ['q'], run: () => rippleTrim('start') },
  { id: 'trimEnd', g: 'edit', label: 'Przytnij koniec do głowicy (z zsunięciem)', short: 'Przytnij kon.', keys: ['w'], run: () => rippleTrim('end') },
  { id: 'extend', g: 'edit', label: 'Dociągnij krawędź klipu do głowicy', short: 'Dociągnij', keys: ['e'], run: extendToPlayhead },
  { id: 'nudgeL', g: 'edit', label: 'Przesuń zaznaczone o klatkę w lewo', short: '◀ 1 kl.', keys: ['alt+left'], rep: true, run: () => nudge(-frame()) },
  { id: 'nudgeR', g: 'edit', label: 'Przesuń zaznaczone o klatkę w prawo', short: '1 kl. ▶', keys: ['alt+right'], rep: true, run: () => nudge(frame()) },
  { id: 'nudgeL10', g: 'edit', label: 'Przesuń zaznaczone o 10 klatek w lewo', short: '◀ 10 kl.', keys: ['alt+shift+left'], rep: true, run: () => nudge(-10 * frame()) },
  { id: 'nudgeR10', g: 'edit', label: 'Przesuń zaznaczone o 10 klatek w prawo', short: '10 kl. ▶', keys: ['alt+shift+right'], rep: true, run: () => nudge(10 * frame()) },
  { id: 'trackUp', g: 'edit', label: 'Przenieś zaznaczone na ścieżkę wyżej', short: 'Ścieżka ↑', keys: ['alt+up'], run: () => moveToTrack(-1) },
  { id: 'trackDown', g: 'edit', label: 'Przenieś zaznaczone na ścieżkę niżej', short: 'Ścieżka ↓', keys: ['alt+down'], run: () => moveToTrack(1) },
  { id: 'copy', g: 'edit', label: 'Kopiuj', short: 'Kopiuj', keys: ['ctrl+c'], run: () => copySelected() },
  { id: 'cut', g: 'edit', label: 'Wytnij', short: 'Wytnij', keys: ['ctrl+x'], run: () => copySelected(true) },
  { id: 'paste', g: 'edit', label: 'Wklej w miejscu głowicy (nadpisz)', short: 'Wklej', keys: ['ctrl+v'], run: () => paste() },
  { id: 'pasteInsert', g: 'edit', label: 'Wklej z rozsunięciem reszty', short: 'Wklej+rozsuń', keys: ['ctrl+shift+v'], run: pasteInsert },
  { id: 'duplicate', g: 'edit', label: 'Duplikuj', short: 'Duplikuj', keys: ['ctrl+d'], run: duplicateSelected },
  { id: 'link', g: 'edit', label: 'Połącz / rozłącz obraz z dźwiękiem', short: 'Połącz', keys: ['ctrl+g'], run: toggleLink },
  { id: 'record', g: 'edit', label: 'Nagrywanie głosu z mikrofonu (otwórz panel / start / stop)', short: 'Nagraj głos', keys: ['shift+r'], run: () => (rec.dlg?.open ? (recRecording() ? recStop() : recStart()) : openRecorder()) },
  { id: 'detach', g: 'edit', label: 'Rozdziel obraz i dźwięk filmu', short: 'Rozdziel', keys: ['ctrl+shift+u'], run: () => splitAV() },
  { id: 'toggleOff', g: 'edit', label: 'Wyłącz / włącz klip', short: 'Wył. klip', keys: ['shift+e'], run: toggleClipsOff },
  { id: 'transition', g: 'edit', label: 'Dodaj przejście (0,5 s)', short: 'Przejście', keys: ['shift+d'], run: addDefaultTransition },
  { id: 'freeze', g: 'edit', label: 'Stopklatka w miejscu głowicy (2 s)', short: 'Stopklatka', keys: ['shift+f'], run: freezeFrame },
  { id: 'matchFrame', g: 'edit', label: 'Pokaż tę klatkę w monitorze źródła', short: 'Klatka źródła', keys: ['f'], run: matchFrame },
  { id: 'addText', g: 'edit', label: 'Dodaj napis', short: 'Napis', keys: ['t'], run: () => addTextClip() },
  { id: 'volDown', g: 'edit', label: 'Ścisz zaznaczone o 1 dB', short: '−1 dB', keys: ['['], rep: true, run: () => volumeStep(-1) },
  { id: 'volUp', g: 'edit', label: 'Podgłośnij zaznaczone o 1 dB', short: '+1 dB', keys: [']'], rep: true, run: () => volumeStep(1) },
  { id: 'undo', g: 'edit', label: 'Cofnij', short: 'Cofnij', keys: ['ctrl+z'], rep: true, run: undo },
  { id: 'redo', g: 'edit', label: 'Ponów', short: 'Ponów', keys: ['ctrl+y', 'ctrl+shift+z'], rep: true, run: redo },

  // Zaznaczanie
  { id: 'selectAll', g: 'select', label: 'Zaznacz wszystko', short: 'Wszystko', keys: ['ctrl+a'], run: selectAll },
  { id: 'deselect', g: 'select', label: 'Odznacz wszystko', short: 'Odznacz', keys: ['ctrl+shift+a', 'escape'], run: () => { setTool('select'); deselectAll(); } },
  { id: 'selectUnder', g: 'select', label: 'Zaznacz klipy pod głowicą', short: 'Pod głowicą', keys: ['d'], run: selectUnderPlayhead },

  // Znaczniki i zakres
  { id: 'marker', g: 'marks', label: 'Dodaj znacznik', short: 'Znacznik', keys: ['m'], run: () => addMarker() },
  { id: 'nextMarker', g: 'marks', label: 'Następny znacznik', short: 'Nast. znacznik', keys: ['shift+m'], run: () => gotoMarker(1) },
  { id: 'prevMarker', g: 'marks', label: 'Poprzedni znacznik', short: 'Poprz. znacznik', keys: ['ctrl+shift+m'], run: () => gotoMarker(-1) },
  { id: 'markIn', g: 'marks', label: 'Początek zakresu (I)', short: 'Początek I', keys: ['i'], run: () => setRangeMark('in') },
  { id: 'markOut', g: 'marks', label: 'Koniec zakresu (O)', short: 'Koniec O', keys: ['o'], run: () => setRangeMark('out') },
  { id: 'gotoIn', g: 'marks', label: 'Idź do początku zakresu', short: '→ I', keys: ['shift+i'], run: () => gotoRange('in') },
  { id: 'gotoOut', g: 'marks', label: 'Idź do końca zakresu', short: '→ O', keys: ['shift+o'], run: () => gotoRange('out') },
  { id: 'clearRange', g: 'marks', label: 'Wyczyść zakres I–O', short: 'Bez zakresu', keys: ['x'], run: clearRange_ },

  // Widok
  { id: 'zoomIn', g: 'view', label: 'Powiększ oś czasu', short: 'Powiększ', keys: ['=', 'shift+=', 'num+'], rep: true, run: () => setZoom(pps * 1.3) },
  { id: 'zoomOut', g: 'view', label: 'Pomniejsz oś czasu', short: 'Pomniejsz', keys: ['-', 'num-'], rep: true, run: () => setZoom(pps / 1.3) },
  { id: 'zoomFit', g: 'view', label: 'Dopasuj oś do okna', short: 'Dopasuj', keys: ['\\', 'shift+z'], run: zoomFit },
  { id: 'snap', g: 'view', label: 'Przyciąganie wł./wył.', short: 'Przyciąganie', keys: ['n'], run: () => toggleSnap() },
  { id: 'guides', g: 'view', label: 'Siatka i strefy bezpieczne', short: 'Siatka', keys: ['g'], run: () => toggleGuides() },
  { id: 'fullscreen', g: 'view', label: 'Podgląd na pełnym ekranie', short: 'Pełny ekran', keys: ['`'], run: toggleFullscreen },
  { id: 'monSwap', g: 'view', label: 'Przełącz monitor program / źródło', short: 'Monitor', keys: ['ctrl+`'], run: () => setMonitor(monitor === 'program' ? 'source' : 'program') },
  { id: 'focusBin', g: 'view', label: 'Przejdź do biblioteki', short: 'Biblioteka', keys: ['shift+1'], run: () => focusPanel(1) },
  { id: 'focusSource', g: 'view', label: 'Przejdź do monitora źródła', short: 'Źródło', keys: ['shift+2'], run: () => focusPanel(2) },
  { id: 'focusTimeline', g: 'view', label: 'Przejdź do osi czasu', short: 'Oś czasu', keys: ['shift+3'], run: () => focusPanel(3) },
  { id: 'focusProgram', g: 'view', label: 'Przejdź do podglądu', short: 'Program', keys: ['shift+4'], run: () => focusPanel(4) },
  { id: 'focusInspector', g: 'view', label: 'Przejdź do właściwości', short: 'Właściwości', keys: ['shift+5'], run: () => focusPanel(5) },
  { id: 'help', g: 'view', label: 'Skróty klawiszowe (to okno)', short: 'Skróty', keys: ['shift+/', '/', 'f1'], run: () => openKeys() }, // „?” to Shift + klawisz „/” — sam klawisz też otwiera

  // Pliki
  { id: 'import', g: 'file', label: 'Importuj pliki', short: 'Import', keys: ['ctrl+i'], run: () => $('#fileInput').click() },
  { id: 'export', g: 'file', label: 'Eksportuj film', short: 'Eksport', keys: ['ctrl+e'], run: openExport },
  { id: 'exportFrame', g: 'file', label: 'Zapisz bieżącą klatkę jako PNG', short: 'Klatka PNG', keys: ['ctrl+shift+e'], run: snapshotPng },
  { id: 'save', g: 'file', label: 'Zapisz teraz (zapis i tak jest automatyczny)', short: 'Zapisz', keys: ['ctrl+s'], run: () => { saveProject(); toast('Zapisano', 1200); } },
  { id: 'projects', g: 'file', label: 'Menu główne (projekty)', short: 'Menu', keys: ['ctrl+o'], run: () => showHome() },
  { id: 'settings', g: 'file', label: 'Ustawienia i układ okna', short: 'Ustawienia', keys: ['ctrl+,'], run: () => openSettings() },
  { id: 'newProject', g: 'file', label: 'Nowy projekt', short: 'Nowy', keys: ['ctrl+alt+n'], run: async () => { await newProject(); toast('Utworzono nowy projekt'); } },

  // Monitor źródła (działają, gdy jest otwarty)
  { id: 'srcPlay', g: 'source', ctx: 'source', label: 'Źródło: odtwórz / pauza', keys: ['space'], run: () => (srcVideo.paused ? srcVideo.play() : srcVideo.pause()) },
  { id: 'srcStop', g: 'source', ctx: 'source', label: 'Źródło: pauza', keys: ['k'], run: () => srcVideo.pause() },
  { id: 'srcFwd', g: 'source', ctx: 'source', label: 'Źródło: do przodu (szybciej)', keys: ['l'], run: () => { srcVideo.playbackRate = srcVideo.paused ? 1 : Math.min(8, srcVideo.playbackRate * 2); srcVideo.play(); } },
  { id: 'srcBack', g: 'source', ctx: 'source', label: 'Źródło: sekunda wstecz', keys: ['j'], rep: true, run: () => srcStep(-1) },
  { id: 'srcFrameBack', g: 'source', ctx: 'source', label: 'Źródło: klatka wstecz', keys: ['left'], rep: true, run: () => srcStep(-frame()) },
  { id: 'srcFrameFwd', g: 'source', ctx: 'source', label: 'Źródło: klatka naprzód', keys: ['right'], rep: true, run: () => srcStep(frame()) },
  { id: 'srcSecBack', g: 'source', ctx: 'source', label: 'Źródło: sekunda wstecz', keys: ['shift+left'], rep: true, run: () => srcStep(-1) },
  { id: 'srcSecFwd', g: 'source', ctx: 'source', label: 'Źródło: sekunda naprzód', keys: ['shift+right'], rep: true, run: () => srcStep(1) },
  { id: 'srcIn', g: 'source', ctx: 'source', label: 'Źródło: początek fragmentu', keys: ['i'], run: () => srcMark('in') },
  { id: 'srcOut', g: 'source', ctx: 'source', label: 'Źródło: koniec fragmentu', keys: ['o'], run: () => srcMark('out') },
  { id: 'srcInsert', g: 'source', ctx: 'source', label: 'Źródło: wstaw z rozsunięciem', keys: [','], run: () => srcPlace('insert') },
  { id: 'srcOverwrite', g: 'source', ctx: 'source', label: 'Źródło: nadpisz w miejscu głowicy', keys: ['.'], run: () => srcPlace('overwrite') },
  { id: 'srcClose', g: 'source', ctx: 'source', label: 'Źródło: wróć do programu', keys: ['escape'], run: () => setMonitor('program') },
];
const CMD_BY_ID = new Map(COMMANDS.map(c => [c.id, c]));
// tych skrótów przeglądarka nie oddaje stronie
const RESERVED = ['ctrl+w', 'ctrl+t', 'ctrl+n', 'ctrl+shift+n', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+tab', 'ctrl+shift+tab', 'alt+f4', 'f11', 'f12', 'ctrl+shift+i', 'ctrl+shift+j'];

/* =========================================================
   Zapis własnych skrótów
   ========================================================= */
let customKeys = {};
try { customKeys = JSON.parse(localStorage.getItem('kadr-keys') || '{}') || {}; } catch { customKeys = {}; }
const keysOf = id => customKeys[id] ?? CMD_BY_ID.get(id)?.keys ?? [];
function saveKeys() {
  try { localStorage.setItem('kadr-keys', JSON.stringify(customKeys)); } catch { /* bez zapisu */ }
  saveUi(); // zalogowanym skróty zapisują się też na koncie
}

const bindings = { global: new Map(), source: new Map() };
function rebuildBindings() {
  bindings.global.clear(); bindings.source.clear();
  for (const c of COMMANDS) for (const k of keysOf(c.id)) {
    const map = c.ctx === 'source' ? bindings.source : bindings.global;
    if (!map.has(k)) map.set(k, c);
  }
  applyKeyHints();
}

/* =========================================================
   Odczyt i opis kombinacji
   ========================================================= */
const CODE_NAMES = {
  Space: 'space', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end',
  PageUp: 'pageup', PageDown: 'pagedown', Delete: 'delete', Backspace: 'backspace', Escape: 'escape', Enter: 'enter',
  NumpadEnter: 'enter', Tab: 'tab', Insert: 'insert', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'num+', NumpadSubtract: 'num-', NumpadMultiply: 'num*', NumpadDivide: 'num/', NumpadDecimal: 'num.',
};
// oparte na fizycznym klawiszu (e.code), więc działa tak samo przy polskim i innych układach
function comboFromEvent(e) {
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  const c = e.code || '';
  let k = null;
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(c)) k = c.slice(5);
  else if (/^Numpad\d$/.test(c)) k = 'num' + c.slice(6);
  else if (/^F\d{1,2}$/.test(c)) k = c.toLowerCase();
  else k = CODE_NAMES[c] || null;
  if (!k && e.key && e.key.length === 1) k = e.key.toLowerCase();
  if (!k) return null;
  const p = [];
  if (e.ctrlKey || e.metaKey) p.push('ctrl');
  if (e.altKey) p.push('alt');
  if (e.shiftKey) p.push('shift');
  p.push(k);
  return p.join('+');
}
const KEY_LABEL = {
  space: 'Spacja', left: '←', right: '→', up: '↑', down: '↓', delete: 'Delete', backspace: 'Backspace', escape: 'Esc', enter: 'Enter',
  home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn', tab: 'Tab', insert: 'Insert',
  'num+': 'Num +', 'num-': 'Num −', 'num*': 'Num *', 'num/': 'Num /', 'num.': 'Num ,', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift',
};
function comboLabel(combo) {
  if (!combo) return '';
  return combo.split('+').map((p, i, a) => {
    if (p === '' && i === a.length - 1) return '+';
    if (KEY_LABEL[p]) return KEY_LABEL[p];
    if (/^num\d$/.test(p)) return 'Num ' + p.slice(3);
    if (/^f\d+$/.test(p)) return p.toUpperCase();
    return p.length === 1 ? p.toUpperCase() : p;
  }).join('+').replace('Shift+/', '?');
}
const keyLabel = id => comboLabel(keysOf(id)[0]);
// „/” obok „Shift+/” to ten sam klawisz — w podpisie wystarczy „?”
const keysLabel = id => { const k = keysOf(id); return k.filter(c => !(c === '/' && k.includes('shift+/'))).map(comboLabel).join(' / '); };

/* =========================================================
   Obsługa klawiatury
   ========================================================= */
document.addEventListener('keydown', e => {
  if (keyCapture) return;
  if (!$('#authScreen').hidden || fp.el || isHomeOpen()) return; // logowanie, menu główne albo wybór czcionki mają własną obsługę klawiszy
  if (!menuEl.hidden && menuKey(e)) return;
  if (document.querySelector('dialog[open]:not(.rec-dlg)')) return; // panel nagrywania nie blokuje skrótów (spacja = odtwarzanie)
  if (e.target.closest('.rec-dlg')) return; // …ale klawisze w samym panelu obsługuje on sam
  if (e.target.closest('input, textarea, select, [contenteditable]')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const combo = comboFromEvent(e);
  if (!combo) return;
  // Enter na przycisku lub karcie działa po swojemu
  if (combo === 'enter' && e.target.closest('button, [role="button"], a')) return;
  const srcActive = monitor === 'source' && srcMediaId;
  const cmd = (srcActive && bindings.source.get(combo)) || bindings.global.get(combo);
  if (!cmd) return;
  e.preventDefault();
  if (e.repeat && !cmd.rep) return;
  cmd.run(e);
});

/* Podpowiedzi przy przyciskach i atrybuty aria-keyshortcuts */
const HINTS = {
  btnPlay: 'play', btnSplit: 'split', btnDelete: 'delete', btnRipple: 'rippleDelete', btnLink: 'link', btnSplitAV: 'detach', btnRecord: 'record', btnMarker: 'marker',
  toolRipple: 'toolRipple', toolRoll: 'toolRoll', toolSlip: 'toolSlip', btnMixer: 'mixer',
  btnText: 'addText', btnSnap: 'snap', btnFit: 'zoomFit', toolSelect: 'toolSelect', toolBlade: 'toolBlade', btnUndo: 'undo',
  btnRedo: 'redo', btnExport: 'export', btnProjects: 'projects', btnImport: 'import', btnGuides: 'guides', btnSnapshot: 'exportFrame',
  btnFull: 'fullscreen', btnPrevEdit: 'prevEdit', btnNextEdit: 'nextEdit', btnPrev: 'frameBack', btnNext: 'frameFwd',
  btnLoop: 'loop', btnMarkIn: 'markIn', btnMarkOut: 'markOut', btnHelp: 'help', btnSettings: 'settings', srcIn: 'srcIn', srcOut: 'srcOut',
  srcInsert: 'srcInsert', srcOverwrite: 'srcOverwrite', srcPlay: 'srcPlay',
};
function applyKeyHints() {
  for (const [id, cmd] of Object.entries(HINTS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.dataset.base ??= (el.title || '').replace(/\s*\([^)]*\)\s*$/, '');
    const k = keysLabel(cmd);
    el.title = k ? `${el.dataset.base} (${k})` : el.dataset.base;
    if (k) el.setAttribute('aria-keyshortcuts', keysOf(cmd).map(x => x.split('+').map(p => KEY_LABEL[p] && p.length > 1 ? (p === 'space' ? 'Space' : p[0].toUpperCase() + p.slice(1)) : p.toUpperCase()).join('+')).join(' '));
    else el.removeAttribute('aria-keyshortcuts');
  }
}

/* =========================================================
   Edytor skrótów
   ========================================================= */
const keysDlg = $('#helpDlg');
let keyCapture = null; // { id, index } — czekamy na nową kombinację
let kbMods = new Set();
let kbFilterCombo = null;

function openKeys() {
  kbFilterCombo = null;
  $('#keySearch').value = '';
  renderKeyboard();
  renderKeyList();
  if (!keysDlg.open) keysDlg.showModal();
  $('#keySearch').focus();
}

const KB_ROWS = [
  [['`', '`'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['0', '0'], ['-', '−'], ['=', '='], ['backspace', '⌫ Backspace', 2]],
  [['tab', 'Tab', 1.5], ['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P'], ['[', '['], [']', ']'], ['\\', '\\', 1.5]],
  [[null, 'Caps', 1.75], ['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L'], [';', ';'], ["'", "'"], ['enter', 'Enter', 2.25]],
  [['@shift', 'Shift', 2.25], ['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M'], [',', ','], ['.', '.'], ['/', '/'], ['@shift', 'Shift', 2.75]],
  [['@ctrl', 'Ctrl', 1.5], ['@alt', 'Alt', 1.5], ['space', 'Spacja', 7], ['@alt', 'Alt', 1.5], ['@ctrl', 'Ctrl', 1.5]],
];
const KB_NAV = [
  [['escape', 'Esc'], ['f1', 'F1'], ['delete', 'Del']],
  [['home', 'Home'], ['end', 'End'], ['pageup', 'PgUp']],
  [null, ['up', '↑'], null],
  [['left', '←'], ['down', '↓'], ['right', '→']],
];
const layerCombo = k => [...['ctrl', 'alt', 'shift'].filter(m => kbMods.has(m)), k].join('+');

function keyCell(def) {
  if (!def) return '<span class="kb-key kb-gap"></span>';
  const [k, label, w = 1] = def;
  const style = `style="--w:${w}"`;
  if (k && k.startsWith('@')) {
    const m = k.slice(1);
    return `<button type="button" class="kb-key kb-mod" ${style} data-mod="${m}" aria-pressed="${kbMods.has(m)}">${label}</button>`;
  }
  if (!k) return `<span class="kb-key kb-dead" ${style}>${label}</span>`;
  const combo = layerCombo(k);
  const cmd = bindings.global.get(combo);
  const col = cmd ? GROUPS[cmd.g].color : '';
  const t = cmd ? `${comboLabel(combo)} — ${cmd.label}` : `${comboLabel(combo)} — wolny`;
  return `<button type="button" class="kb-key${cmd ? ' bound' : ''}${kbFilterCombo === combo ? ' active' : ''}" style="--w:${w}${col ? `;--g:${col}` : ''}" data-combo="${esc(combo)}" title="${esc(t)}">
    <span class="kb-cap">${esc(label)}</span>${cmd ? `<span class="kb-cmd">${esc(cmd.short || cmd.label)}</span>` : ''}</button>`;
}
function renderKeyboard() {
  $('#kbMain').innerHTML = KB_ROWS.map(r => `<div class="kb-row">${r.map(keyCell).join('')}</div>`).join('');
  $('#kbNav').innerHTML = KB_NAV.map(r => `<div class="kb-row">${r.map(keyCell).join('')}</div>`).join('');
  $('#kbLegend').innerHTML = Object.values(GROUPS).filter(g => g.name !== 'Monitor źródła').map(g => `<span><i style="background:${g.color}"></i>${g.name}</span>`).join('');
  const layer = ['ctrl', 'alt', 'shift'].filter(m => kbMods.has(m)).map(m => KEY_LABEL[m]).join('+');
  $('#kbLayer').textContent = layer ? `Pokazuję skróty z: ${layer}` : 'Pokazuję skróty bez klawiszy specjalnych — kliknij Ctrl, Alt lub Shift, żeby zobaczyć kolejne warstwy';
}

function renderKeyList() {
  const q = $('#keySearch').value.trim().toLowerCase();
  const rows = [];
  for (const [gid, g] of Object.entries(GROUPS)) {
    const cmds = COMMANDS.filter(c => c.g === gid).filter(c => {
      const ks = keysOf(c.id);
      if (kbFilterCombo) return ks.includes(kbFilterCombo);
      if (!q) return true;
      return c.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q) || ks.some(k => comboLabel(k).toLowerCase().includes(q));
    });
    if (!cmds.length) continue;
    rows.push(`<h3><i style="background:${g.color}"></i>${g.name}${gid === 'source' ? ' <small>— działają, gdy otwarty jest monitor źródła</small>' : ''}</h3>`);
    for (const c of cmds) {
      const ks = keysOf(c.id);
      const changed = customKeys[c.id] !== undefined;
      const chips = ks.map((k, i) => {
        const cap = keyCapture && keyCapture.id === c.id && keyCapture.index === i;
        return `<span class="kchip${cap ? ' capturing' : ''}"><button type="button" class="kchip-k" data-edit="${c.id}" data-i="${i}" title="Kliknij i naciśnij nową kombinację">${cap ? 'Naciśnij klawisze…' : esc(comboLabel(k))}</button><button type="button" class="kchip-x" data-rm="${c.id}" data-i="${i}" aria-label="Usuń skrót ${esc(comboLabel(k))} z polecenia ${esc(c.label)}">×</button></span>`;
      }).join('');
      const addCap = keyCapture && keyCapture.id === c.id && keyCapture.index === null;
      rows.push(`<div class="krow${changed ? ' changed' : ''}"><span class="klabel">${esc(c.label)}</span>
        <span class="kchips">${chips}<button type="button" class="kadd${addCap ? ' capturing' : ''}" data-add="${c.id}" title="Dodaj kolejny skrót">${addCap ? 'Naciśnij klawisze…' : '+'}</button>
        ${changed ? `<button type="button" class="kreset" data-reset="${c.id}" title="Przywróć domyślny: ${esc(c.keys.map(comboLabel).join(' / ') || 'brak')}">↺</button>` : ''}</span></div>`);
    }
  }
  if (kbFilterCombo && !rows.length) rows.push(`<p class="hint">Kombinacja <kbd>${esc(comboLabel(kbFilterCombo))}</kbd> jest wolna. Kliknij „+” przy dowolnym poleceniu, żeby ją przypisać.</p>`);
  else if (!rows.length) rows.push(`<p class="hint">Nic nie pasuje do „${esc(q)}”.</p>`);
  $('#keyList').innerHTML = rows.join('');
  $('#keyFilterNote').hidden = !kbFilterCombo;
  if (kbFilterCombo) $('#keyFilterNote').innerHTML = `Polecenia pod <kbd>${esc(comboLabel(kbFilterCombo))}</kbd> · <button type="button" class="linkbtn" id="keyFilterClear">pokaż wszystkie</button>`;
}

function assignKey(id, index, combo) {
  const cmd = CMD_BY_ID.get(id);
  if (RESERVED.includes(combo)) { toast(`${comboLabel(combo)} jest zajęty przez przeglądarkę — wybierz inny`, 3500); return; }
  const sameCtx = c => (c.ctx || 'global') === (cmd.ctx || 'global');
  for (const other of COMMANDS) {
    if (other.id === id || !sameCtx(other)) continue;
    const ks = keysOf(other.id);
    if (ks.includes(combo)) {
      customKeys[other.id] = ks.filter(k => k !== combo);
      toast(`${comboLabel(combo)} przeniesiony z „${other.label}”`, 3500);
    }
  }
  const list = [...keysOf(id)];
  if (index === null) list.push(combo); else list[index] = combo;
  customKeys[id] = [...new Set(list)];
  normalizeCustom();
  saveKeys(); rebuildBindings();
}
function normalizeCustom() {
  // wpisy identyczne z domyślnymi nie są „zmianą”
  for (const [id, ks] of Object.entries(customKeys)) {
    const def = CMD_BY_ID.get(id)?.keys;
    if (!def || (ks.length === def.length && ks.every((k, i) => k === def[i]))) delete customKeys[id];
  }
}

// przechwycenie nowej kombinacji (faza capture, zanim zareaguje okno dialogowe)
window.addEventListener('keydown', e => {
  if (!keyCapture) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { keyCapture = null; renderKeyList(); return; }
  const combo = comboFromEvent(e);
  if (!combo) return;
  const { id, index } = keyCapture;
  keyCapture = null;
  assignKey(id, index, combo);
  renderKeyList(); renderKeyboard();
}, true);
keysDlg.addEventListener('cancel', e => { if (keyCapture) e.preventDefault(); });

$('#keyList').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-add]'), rs = e.target.closest('[data-reset]');
  if (ed) keyCapture = { id: ed.dataset.edit, index: +ed.dataset.i };
  else if (add) keyCapture = { id: add.dataset.add, index: null };
  else if (rm) {
    const id = rm.dataset.rm;
    customKeys[id] = keysOf(id).filter((_, i) => i !== +rm.dataset.i);
    normalizeCustom(); saveKeys(); rebuildBindings(); renderKeyboard();
  } else if (rs) {
    delete customKeys[rs.dataset.reset];
    saveKeys(); rebuildBindings(); renderKeyboard();
  } else return;
  renderKeyList();
});
$('#keyFilterNote').addEventListener('click', e => { if (e.target.id === 'keyFilterClear') { kbFilterCombo = null; renderKeyList(); renderKeyboard(); } });
$('#keySearch').addEventListener('input', () => { kbFilterCombo = null; renderKeyList(); renderKeyboard(); });
$('#keysKb').addEventListener('click', e => {
  const mod = e.target.closest('[data-mod]'), key = e.target.closest('[data-combo]');
  if (mod) { const m = mod.dataset.mod; kbMods.has(m) ? kbMods.delete(m) : kbMods.add(m); renderKeyboard(); }
  else if (key) { kbFilterCombo = kbFilterCombo === key.dataset.combo ? null : key.dataset.combo; $('#keySearch').value = ''; renderKeyboard(); renderKeyList(); }
});
$('#keyReset').addEventListener('click', () => {
  if (!Object.keys(customKeys).length) { toast('Wszystkie skróty są domyślne'); return; }
  if (!confirm('Przywrócić wszystkie skróty do ustawień domyślnych?')) return;
  customKeys = {};
  saveKeys(); rebuildBindings(); renderKeyboard(); renderKeyList();
});
$('#keyPrint').addEventListener('click', () => {
  const html = Object.entries(GROUPS).map(([gid, g]) => `<h2>${g.name}</h2><table>${COMMANDS.filter(c => c.g === gid && keysOf(c.id).length)
    .map(c => `<tr><td>${esc(c.label)}</td><td>${esc(keysLabel(c.id))}</td></tr>`).join('')}</table>`).join('');
  const w = window.open('', '_blank');
  if (!w) { toast('Przeglądarka zablokowała nowe okno'); return; }
  w.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>CloudCut — ściągawka skrótów</title><style>
    body{font:12px/1.4 Inter,Arial,sans-serif;columns:2;column-gap:32px;margin:24px;color:#111}h1{column-span:all;font-size:18px}
    h2{font-size:13px;margin:14px 0 4px;break-after:avoid}table{width:100%;border-collapse:collapse;break-inside:avoid}
    td{padding:3px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-family:Consolas,monospace;font-weight:600;white-space:nowrap;padding-left:10px}
  </style></head><body><h1>CloudCut — skróty klawiszowe</h1>${html}<script>print()<\/script></body></html>`);
  w.document.close();
});
$('#helpClose').addEventListener('click', () => keysDlg.close());

rebuildBindings();
