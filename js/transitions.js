'use strict';
/* transitions.js — przejścia między klipami: biblioteka, nakładanie i podgląd */

const TRANSITIONS = [
  { id: 'cross', name: 'Przenikanie', cat: 'Podstawowe' },
  { id: 'dip-black', name: 'Przez czerń', cat: 'Podstawowe' },
  { id: 'dip-white', name: 'Przez biel', cat: 'Podstawowe' },
  { id: 'flash', name: 'Błysk', cat: 'Podstawowe' },
  { id: 'wipe-l', name: 'Wycieranie ←', cat: 'Wycieranie' },
  { id: 'wipe-r', name: 'Wycieranie →', cat: 'Wycieranie' },
  { id: 'wipe-u', name: 'Wycieranie ↑', cat: 'Wycieranie' },
  { id: 'wipe-d', name: 'Wycieranie ↓', cat: 'Wycieranie' },
  { id: 'barn', name: 'Drzwi', cat: 'Wycieranie' },
  { id: 'blinds', name: 'Żaluzje', cat: 'Wycieranie' },
  { id: 'push-l', name: 'Wypchnięcie ←', cat: 'Ruch' },
  { id: 'push-r', name: 'Wypchnięcie →', cat: 'Ruch' },
  { id: 'push-u', name: 'Wypchnięcie ↑', cat: 'Ruch' },
  { id: 'push-d', name: 'Wypchnięcie ↓', cat: 'Ruch' },
  { id: 'cover-l', name: 'Nasunięcie ←', cat: 'Ruch' },
  { id: 'cover-r', name: 'Nasunięcie →', cat: 'Ruch' },
  { id: 'cover-u', name: 'Nasunięcie ↑', cat: 'Ruch' },
  { id: 'cover-d', name: 'Nasunięcie ↓', cat: 'Ruch' },
  { id: 'whip', name: 'Szybka panorama', cat: 'Ruch' },
  { id: 'iris', name: 'Koło', cat: 'Kształty' },
  { id: 'diamond', name: 'Romb', cat: 'Kształty' },
  { id: 'clock', name: 'Zegar', cat: 'Kształty' },
  { id: 'zoom-in-t', name: 'Najazd', cat: 'Dynamiczne' },
  { id: 'zoom-out-t', name: 'Odjazd', cat: 'Dynamiczne' },
  { id: 'spin-t', name: 'Wir', cat: 'Dynamiczne' },
  { id: 'blur-t', name: 'Rozmycie', cat: 'Dynamiczne' },
  { id: 'glitch', name: 'Glitch', cat: 'Dynamiczne' },
];
const TRANS_IDS = new Set(TRANSITIONS.map(t => t.id));
const transName = id => TRANSITIONS.find(t => t.id === id)?.name || id;
let transDur = 0.8;

/* Gdzie nałożyć: zaznaczone klipy albo cięcie najbliżej głowicy */
function transitionTargets() {
  let s = selectedClips().filter(c => !isLocked(c));
  if (s.length) {
    // z połączonej pary obraz+dźwięk przejście trafia do obu
    return s;
  }
  let best = null, bd = Infinity;
  for (const c of state.clips) {
    if (isLocked(c) || c.off) continue;
    const d = Math.abs(c.start - playhead);
    if (d < bd && d < 1.5 && c.start > EPS) { bd = d; best = c; }
  }
  return best ? groupMembers(best) : [];
}
function applyTransition(id, clips = transitionTargets(), dur = transDur) {
  if (!clips.length) { toast('Zaznacz klip albo ustaw głowicę przy cięciu między klipami'); return 0; }
  for (const c of clips) {
    const d = Math.min(dur, c.dur * 0.9);
    c.props.inType = c.kind === 'audio' ? 'cross' : id;
    c.props.fadeIn = Math.round(d * 100) / 100;
  }
  commit(); renderAll();
  toast(`${transName(id)} — ${String(Math.min(dur, clips[0].dur * 0.9).toFixed(2)).replace('.', ',')} s`, 1500);
  return clips.length;
}
function applyToAllCuts(id) {
  let n = 0;
  for (const c of state.clips) {
    if (isLocked(c) || c.off) continue;
    const prev = state.clips.find(p => p.trackId === c.trackId && p.id !== c.id && Math.abs(clipEnd(p) - c.start) < 0.002);
    if (!prev) continue;
    const d = Math.min(transDur, c.dur * 0.9);
    c.props.inType = c.kind === 'audio' ? 'cross' : id;
    c.props.fadeIn = Math.round(d * 100) / 100;
    n++;
  }
  if (!n) { toast('Nie ma cięć między stykającymi się klipami'); return; }
  commit(); renderAll();
  toast(`Dodano „${transName(id)}” do ${n} cięć`);
}
function removeTransitions(clips = selectedClips()) {
  let n = 0;
  for (const c of clips) if (isTransition(c.props.inType)) { c.props.inType = 'fade'; c.props.fadeIn = 0; n++; }
  if (n) { commit(); renderAll(); }
  return n;
}

/* ---------------- Zakładka „Przejścia” ---------------- */
function renderTransitions() {
  const cats = [...new Set(TRANSITIONS.map(t => t.cat))];
  $('#transList').innerHTML = cats.map(cat => `<h3 class="bin-h">${cat}</h3><div class="preset-grid">${TRANSITIONS.filter(t => t.cat === cat).map(t =>
    `<button class="p-card t-card" draggable="true" data-trans="${t.id}" title="Kliknij: nałóż na zaznaczony klip lub cięcie przy głowicy. Przeciągnij: upuść na cięcie.">
      <div class="p-prev tp tp-${t.id}"><i class="ta"></i><i class="tb"></i></div><span class="p-name">${t.name}</span></button>`).join('')}</div>`).join('');
}
$('#transDur').addEventListener('input', e => { transDur = +e.target.value; $('#transDurOut').textContent = transDur.toFixed(1).replace('.', ',') + ' s'; });
$('#transList').addEventListener('click', e => {
  const b = e.target.closest('[data-trans]');
  if (b) applyTransition(b.dataset.trans);
});
$('#transList').addEventListener('dragstart', e => {
  const b = e.target.closest('[data-trans]');
  if (!b) return;
  e.dataTransfer.setData('text/x-kadr-trans', b.dataset.trans);
  e.dataTransfer.effectAllowed = 'copy';
});
$('#transAll').addEventListener('click', () => {
  const id = $('#transAllType').value;
  applyToAllCuts(id);
});
$('#transClear').addEventListener('click', () => {
  const n = removeTransitions(selectedClips().length ? selectedClips() : state.clips);
  toast(n ? `Usunięto przejścia: ${n}` : 'Brak przejść do usunięcia');
});

/* Upuszczenie przejścia na oś: najbliższe cięcie na tej ścieżce */
function dropTransition(id, trackId, t) {
  const list = clipsOn(trackId).filter(c => !c.off);
  let best = null, bd = Infinity;
  for (const c of list) {
    const d = Math.abs(c.start - t);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best || bd > Math.max(1.5, 60 / pps)) { toast('Upuść przejście blisko cięcia między klipami'); return; }
  applyTransition(id, groupMembers(best));
  sel = new Set(groupMembers(best).map(c => c.id));
  renderLanes(); renderInspector();
}
