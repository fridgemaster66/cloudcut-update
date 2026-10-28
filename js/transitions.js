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

/* ---------------- Filtry ---------------- */
/* Na co: zaznaczone klipy z obrazem, a bez zaznaczenia — widoczny klip pod głowicą na najwyższej ścieżce */
function filterTargets() {
  const s = selectedClips().filter(c => isVisual(c) && !isLocked(c));
  if (s.length) return s;
  for (const tr of state.tracks) {
    if (tr.kind !== 'video' || tr.hidden || tr.locked) continue;
    const c = clipsOn(tr.id).find(x => !x.off && playhead >= x.start && playhead < clipEnd(x));
    if (c) return [c];
  }
  return [];
}
function clearFilterOn(c) {
  const f = FILTERS.find(x => x.id === c.props.filter);
  if (f) {
    for (const k of Object.keys(f.fx || {})) c.props.fx[k] = FX0[k];
    for (const k of Object.keys(f.efx || {})) c.props.efx[k] = EFX0[k];
    if (f.shake) c.props.shake = { ...SHAKE0 };
    if (f.punch) c.props.punch = { ...PUNCH0 };
  }
  c.props.filter = null;
}
function applyFilter(id, clips = filterTargets(), at = playhead) {
  const f = FILTERS.find(x => x.id === id);
  if (!clips.length) { toast('Zaznacz klip albo ustaw głowicę na filmie — albo przeciągnij filtr na klip'); return 0; }
  for (const c of clips) {
    fillDefaults(c);
    clearFilterOn(c);
    if (!f) continue;
    Object.assign(c.props.fx, f.fx || {});
    Object.assign(c.props.efx, f.efx || {});
    if (f.shake) c.props.shake = { ...SHAKE0, ...f.shake };
    if (f.punch) {
      // oddalenie zaczyna się w miejscu głowicy (gdy stoi na klipie), inaczej na początku klipu
      const local = at >= c.start && at < clipEnd(c) ? at - c.start : 0;
      const dur = Math.min(0.6, c.dur);
      c.props.punch = { amt: 0.3, dur, at: Math.round(clamp(local, 0, Math.max(0, c.dur - dur)) * 100) / 100 };
    }
    c.props.filter = f.id;
  }
  commit(); renderAll();
  toast(f ? `Filtr „${f.name}” — ${clips.length === 1 ? clipLabel(clips[0]) : plural(clips.length, 'klip', 'klipy', 'klipów')}` : 'Zdjęto filtr', 1800);
  return clips.length;
}
/* Podgląd na karcie: przykładowa scena z tym samym filtrem (kolor przybliżony filtrem CSS) */
function filterPreviewCss(f) {
  const fx = { ...FX0, ...(f.fx || {}) }, e = f.efx || {};
  let css = buildFilter(fx, 0, '');
  if (e.invert) css += ' invert(1)';
  if (e.glow) css += ` brightness(${1 + e.glow / 400}) saturate(${1 + e.glow / 300})`;
  if (e.posterize) css += ' contrast(1.35)';
  if (e.shadows) css += ' brightness(1.08)';
  return css.trim() || 'none';
}
function renderFilters() {
  const cats = [...new Set(FILTERS.map(f => f.cat))];
  $('#filterList').innerHTML = cats.map(cat => `<h3 class="bin-h">${cat}</h3><div class="preset-grid">${FILTERS.filter(f => f.cat === cat).map(f => {
    const fx = f.fx || {}, tint = fx.temp ? `<i class="fp-tint" style="background:${fx.temp > 0 ? '#ff8a1f' : '#1f7bff'};opacity:${Math.abs(fx.temp) / 100 * 0.6}"></i>` : '';
    const vig = fx.vignette ? `<i class="fp-vig" style="opacity:${fx.vignette / 100}"></i>` : '';
    const tone = f.efx?.tintSAmt ? '<i class="fp-tone"></i>' : '';
    return `<button class="p-card t-card f-card" draggable="true" data-filter="${f.id}" title="${esc(f.desc || f.name)} — kliknij: nałóż na zaznaczone klipy. Przeciągnij na klip.">
      <div class="p-prev fp fp-${f.id}"><i class="fp-scene" style="filter:${filterPreviewCss(f)}"></i>${tint}${tone}${vig}</div><span class="p-name">${f.name}</span></button>`;
  }).join('')}</div>`).join('');
}
function setTransMode(filters) {
  $('#tmTrans').setAttribute('aria-pressed', !filters);
  $('#tmFilters').setAttribute('aria-pressed', filters);
  $('#transPane').hidden = filters;
  $('#filterPane').hidden = !filters;
  if (filters && !$('#filterList').children.length) renderFilters();
}
$('#tmTrans').addEventListener('click', () => setTransMode(false));
$('#tmFilters').addEventListener('click', () => setTransMode(true));
$('#filterList').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]');
  if (b) applyFilter(b.dataset.filter);
});
$('#filterList').addEventListener('dragstart', e => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  e.dataTransfer.setData('text/x-kadr-filter', b.dataset.filter);
  e.dataTransfer.effectAllowed = 'copy';
});
$('#filterClear').addEventListener('click', () => {
  const s = selectedClips().filter(c => c.props.filter);
  applyFilter(null, s.length ? s : filterTargets());
});
/* Upuszczenie filtra na oś: klip pod kursorem */
function dropFilter(id, trackId, t) {
  const c = clipsOn(trackId).find(x => t >= x.start - EPS && t < clipEnd(x) + EPS);
  if (!c || !isVisual(c)) { toast('Upuść filtr na klipie z obrazem'); return; }
  if (isLocked(c)) { toast('Ścieżka tego klipu jest zablokowana'); return; }
  sel = new Set([c.id]);
  // oddalenie zaczyna się w miejscu głowicy, a gdy głowica stoi poza klipem — tam, gdzie upuszczono
  applyFilter(id, [c], playhead >= c.start && playhead < clipEnd(c) ? playhead : t);
  renderInspector();
}

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
