'use strict';
/* timeline.js — operacje montażowe i oś czasu */

const scrollEl = $('#tlScroll');
const inner = $('#tlInner');
const lanesEl = $('#tlLanes');
const headsEl = $('#tlHeads');
const rulerEl = $('#tlRuler');
const rulerCv = $('#rulerCv');
const playheadEl = $('#playhead');
const TEXT_H = 44;

/* =========================================================
   Operacje montażowe
   ========================================================= */
function trimStartTo(c, t) {
  const d = t - c.start;
  c.start = t;
  c.in += d * c.speed;
  c.dur -= d;
  shiftKf(c, -d);
}
function splitClip(c, t) {
  const cut = t - c.start;
  const r = structuredClone(c);
  r.id = uid('c');
  r.start = t;
  r.in = c.in + cut * c.speed;
  r.dur = c.dur - cut;
  r.props.fadeIn = 0;
  if (r.props.inType === 'cross') r.props.inType = 'fade';
  const [lk, rk] = splitKf(c.kf, cut);
  c.kf = lk; r.kf = rk;
  const pu = c.props.punch;
  if (pu?.amt > 0) {
    r.props.punch = pu.at + pu.dur > cut ? { ...pu, at: pu.at - cut } : { ...PUNCH0 };
    if (pu.at >= cut) c.props.punch = { ...PUNCH0 };
  }
  c.dur = cut;
  c.props.fadeOut = 0;
  state.clips.push(r);
  return r;
}
function splitAt(t, clips) {
  let targets = clips || state.clips.filter(c => t > c.start + EPS && t < clipEnd(c) - EPS && !isLocked(c));
  if (!clips && sel.size) {
    const s = targets.filter(c => sel.has(c.id));
    if (s.length) targets = s;
  }
  targets = targets.filter(c => t > c.start + EPS && t < clipEnd(c) - EPS);
  if (!targets.length) { toast('Ustaw głowicę na klipie, który chcesz przeciąć'); return; }
  const groups = new Map();
  const newSel = new Set();
  for (const c of targets) {
    const r = splitClip(c, t);
    if (c.group) {
      if (!groups.has(c.group)) groups.set(c.group, uid('g'));
      r.group = groups.get(c.group);
    }
    if (sel.has(c.id)) newSel.add(r.id);
  }
  sel = newSel;
  commit(); renderAll();
}

/* Zwolnienie miejsca na ścieżce: tnie i usuwa wszystko w przedziale [s, e) */
function clearRange(trackId, s, e) {
  for (const c of state.clips.filter(x => x.trackId === trackId)) {
    const cs = c.start, ce = clipEnd(c);
    if (ce <= s + EPS || cs >= e - EPS) continue;
    if (cs >= s - EPS && ce <= e + EPS) { state.clips = state.clips.filter(x => x !== c); sel.delete(c.id); }
    else if (cs < s && ce > e) { const r = splitClip(c, e); r.group = null; c.dur = s - cs; c.group = null; }
    else if (cs < s) { c.dur = s - cs; c.props.fadeOut = 0; }
    else { trimStartTo(c, e); c.props.fadeIn = 0; }
  }
}
/* Rozsunięcie wszystkich odblokowanych ścieżek od t o d sekund */
function rippleInsert(t, d) {
  const groups = new Map(); // prawe połówki połączonych klipów tworzą własną, nową parę
  for (const tr of state.tracks) {
    if (tr.locked) continue;
    for (const c of state.clips.filter(x => x.trackId === tr.id && t > x.start + EPS && t < clipEnd(x) - EPS)) {
      const r = splitClip(c, t);
      if (c.group) {
        if (!groups.has(c.group)) groups.set(c.group, uid('g'));
        r.group = groups.get(c.group);
      }
    }
    for (const c of state.clips) if (c.trackId === tr.id && c.start >= t - EPS) c.start += d;
  }
  for (const m of state.markers) if (m.t >= t) m.t += d;
}

function placeMedia(m, { t = playhead, trackId = null, srcIn = 0, srcDur = null, mode = 'overwrite' } = {}) {
  if (!m || m.loading) return [];
  let kind = m.kind;
  let tr = trackId ? state.tracks.find(x => x.id === trackId) : null;
  if (tr && tr.kind === 'audio' && kind === 'video') kind = 'audio'; // sam dźwięk z filmu
  const need = laneKind(kind);
  if (!tr || tr.kind !== need || tr.locked) tr = defaultTrack(need);
  t = Math.max(0, t);
  const dur = Math.max(frame(), srcDur ?? (kind === 'image' ? 5 : m.duration - srcIn));
  if (mode === 'insert') rippleInsert(t, dur);
  else clearRange(tr.id, t, t + dur);
  // film trafia na oś razem ze swoim dźwiękiem w jednym klipie — osobny klip audio daje dopiero „Rozdziel”
  const v = newClip(kind, tr.id, t, dur, { mediaId: m.id, in: srcIn, name: m.name });
  state.clips.push(v);
  const out = [v];
  sel = new Set(out.map(c => c.id));
  gcPlayers();
  commit(); renderAll(); renderBin();
  return out;
}

function addTextClip(presetKey = null, t = playhead, trackId = null) {
  const pr = TITLE_PRESETS.find(p => p.key === presetKey);
  const dur = pr?.dur || 4;
  t = Math.max(0, t);
  let tr = trackId ? state.tracks.find(x => x.id === trackId && x.kind === 'text' && !x.locked) : null;
  // bez wskazanej ścieżki: pierwsza ścieżka napisów wolna w tym miejscu, a w ostateczności nowa
  tr ||= state.tracks.find(x => x.kind === 'text' && !x.locked && !overlaps(x.id, t, t + dur)) || addTrack('text', false);
  const c = newClip('text', tr.id, 0, dur, { name: pr?.name || 'Napis' });
  if (pr) Object.assign(c.props, pr.p(state.w, state.h));
  if (pr?.anchor === 'left') c.props.x = Math.round(-state.w / 2 + state.w * 0.06 + textLayout(c.props).w / 2);
  c.start = freeSlot(tr.id, t, dur);
  state.clips.push(c);
  sel = new Set([c.id]);
  commit(); renderAll();
  return c;
}
/* Komentarz: notatka dla siebie na ścieżce komentarzy — nie pojawia się w filmie */
function addComment(t = playhead, trackId = null) {
  const dur = 3;
  t = Math.max(0, t);
  let tr = trackId ? state.tracks.find(x => x.id === trackId && x.kind === 'note' && !x.locked) : null;
  tr ||= state.tracks.find(x => x.kind === 'note' && !x.locked && !overlaps(x.id, t, t + dur)) || addTrack('note', false);
  const c = newClip('note', tr.id, freeSlot(tr.id, t, dur), dur, { name: '' });
  state.clips.push(c);
  sel = new Set([c.id]);
  commit(); renderAll();
  inspClosed.delete('note');
  $('#n-text')?.focus();
  return c;
}
function addColorClip(presetKey, t = playhead, trackId = null) {
  let tr = trackId ? state.tracks.find(x => x.id === trackId && x.kind === 'video' && !x.locked) : null;
  tr ||= defaultTrack('video');
  const pr = SOLID_PRESETS.find(p => p.key === presetKey) || SOLID_PRESETS[0];
  const dur = 5;
  t = Math.max(0, t);
  clearRange(tr.id, t, t + dur);
  const c = newClip('color', tr.id, t, dur, { name: pr.name });
  Object.assign(c.props, pr.p);
  state.clips.push(c);
  sel = new Set([c.id]);
  commit(); renderAll();
  return c;
}

function deleteSelected(ripple) {
  const gone = selectedClips().filter(c => !isLocked(c));
  if (!gone.length) return;
  const ids = new Set(gone.map(c => c.id));
  state.clips = state.clips.filter(c => !ids.has(c.id));
  if (ripple) {
    for (const g of gone.sort((a, b) => b.start - a.start)) {
      for (const c of state.clips) if (c.trackId === g.trackId && c.start >= clipEnd(g) - EPS) c.start = Math.max(0, c.start - g.dur);
    }
  }
  sel.clear();
  gcPlayers();
  commit(); renderAll(); renderBin();
}

function duplicateSelected() {
  const src = selectedClips();
  if (!src.length) return;
  const groups = new Map();
  const newSel = new Set();
  const span = Math.max(...src.map(clipEnd)) - Math.min(...src.map(c => c.start));
  for (const c of src) {
    const d = structuredClone(c);
    d.id = uid('c');
    if (c.group) { if (!groups.has(c.group)) groups.set(c.group, uid('g')); d.group = groups.get(c.group); }
    d.start = c.start + span;
    clearRange(d.trackId, d.start, clipEnd(d));
    state.clips.push(d);
    newSel.add(d.id);
  }
  sel = newSel;
  commit(); renderAll();
}

function copySelected(cut = false) {
  const src = selectedClips();
  if (!src.length) return;
  const t0 = Math.min(...src.map(c => c.start));
  clipboard = src.map(c => ({ ...structuredClone(c), _off: c.start - t0 }));
  if (cut) deleteSelected(false);
  toast(`${cut ? 'Wycięto' : 'Skopiowano'} ${src.length} ${src.length === 1 ? 'klip' : 'klipy'}`);
}
function paste(t = playhead) {
  if (!clipboard?.length) { toast('Schowek jest pusty'); return; }
  const groups = new Map();
  const newSel = new Set();
  for (const s of clipboard) {
    const c = structuredClone(s);
    delete c._off;
    c.id = uid('c');
    c.start = t + s._off;
    if (!state.tracks.some(tr => tr.id === c.trackId && !tr.locked)) c.trackId = defaultTrack(laneKind(c.kind)).id;
    if (c.mediaId && !media.has(c.mediaId)) continue;
    if (c.group) { if (!groups.has(c.group)) groups.set(c.group, uid('g')); c.group = groups.get(c.group); }
    clearRange(c.trackId, c.start, clipEnd(c));
    state.clips.push(c);
    newSel.add(c.id);
  }
  sel = newSel;
  commit(); renderAll();
}

function unlinkSelected() {
  const s = selectedClips().filter(c => c.group);
  if (!s.length) { toast('Zaznaczone klipy nie są połączone'); return; }
  for (const c of s) c.group = null;
  toast('Rozłączono — klipy można teraz edytować osobno');
  commit(); renderLanes(); renderInspector();
}

/* „Połącz”: z dwóch elementów robi jeden.
   1) kawałki tego samego pliku, które stykają się na jednej ścieżce (np. po przecięciu) → jeden klip,
   2) film z odłączonym dźwiękiem leżącym dokładnie pod nim → znowu jeden klip z dźwiękiem,
   3) różne pliki nie zmieszczą się w jednym klipie — łączą się w grupę, która przesuwa się i tnie razem. */
const JOIN_SKIP = new Set(['fadeIn', 'fadeOut', 'inType', 'outType']);
const joinProps = c => JSON.stringify(Object.entries(c.props).filter(([k]) => !JOIN_SKIP.has(k)));
function canHeal(a, b) {
  if (a.kind !== b.kind || a.trackId !== b.trackId || !!a.off !== !!b.off || Math.abs(clipEnd(a) - b.start) > 0.002) return false;
  if (a.mediaId !== b.mediaId || joinProps(a) !== joinProps(b)) return false;
  if (!isAV(a)) return true; // obraz, napis, plansza, kształt: te same ustawienia
  return Math.abs(a.speed - b.speed) < 1e-6 && Math.abs(a.in + a.dur * a.speed - b.in) < 0.01; // materiał leci dalej bez skoku
}
function healInto(a, b) {
  const off = a.dur;
  a.kf ??= {};
  for (const [n, k] of Object.entries(b.kf || {})) {
    const all = [...(a.kf[n] || []), ...k.map(f => ({ t: f.t + off, v: f.v }))].sort((x, y) => x.t - y.t);
    a.kf[n] = all.filter((f, i) => !i || Math.abs(f.t - all[i - 1].t) > 1e-4 || f.v !== all[i - 1].v); // klatka w miejscu cięcia była po obu stronach
  }
  a.dur = clipEnd(b) - a.start;
  a.props.fadeOut = b.props.fadeOut;
  if (b.props.outType !== undefined) a.props.outType = b.props.outType;
}
const isOwnAudio = (v, a) => v.kind === 'video' && a.kind === 'audio' && v.props.detached && v.mediaId === a.mediaId &&
  Math.abs(v.start - a.start) < 0.002 && Math.abs(v.dur - a.dur) < 0.002 && Math.abs(v.in - a.in) < 0.01 && Math.abs(v.speed - a.speed) < 1e-6;
function reattachAudio(v, a) {
  v.props.detached = false;
  v.props.volume = a.props.volume ?? 1;
  if (a.props.afx) v.props.afx = structuredClone(a.props.afx);
  v.kf ??= {};
  if (a.kf?.volume?.length) v.kf.volume = structuredClone(a.kf.volume); else delete v.kf.volume;
}
function joinSelected() {
  const s = selectedClips().filter(c => !isLocked(c));
  if (s.length < 2) { toast('Zaznacz dwa klipy (Shift+klik), które mają stać się jednym'); return; }
  const removed = new Set();
  let healed = 0, reattached = 0;
  const byTrack = new Map();
  for (const c of s) { if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []); byTrack.get(c.trackId).push(c); }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur = list[0];
    for (const nx of list.slice(1)) {
      if (canHeal(cur, nx)) { healInto(cur, nx); removed.add(nx.id); healed++; } else cur = nx;
    }
  }
  if (!healed) {
    for (const v of s.filter(c => c.kind === 'video' && c.props.detached)) {
      const a = s.find(x => !removed.has(x.id) && isOwnAudio(v, x));
      if (a) { reattachAudio(v, a); removed.add(a.id); reattached++; }
    }
  }
  if (!healed && !reattached) {
    // różne pliki — jedna grupa (albo, gdy już są razem, rozłączenie)
    if (s.every(c => c.group && c.group === s[0].group)) { unlinkSelected(); return; }
    const g = uid('g');
    for (const c of s) c.group = g;
    toast('To różne pliki, więc nie da się ich scalić w jeden klip — połączyłem je w grupę: przesuwają się i tną razem', 5000);
    commit(); renderLanes(); renderInspector();
    return;
  }
  state.clips = state.clips.filter(c => !removed.has(c.id));
  for (const id of removed) sel.delete(id);
  // grupy, z których został jeden klip, przestają być grupami
  const count = new Map();
  for (const c of state.clips) if (c.group) count.set(c.group, (count.get(c.group) || 0) + 1);
  for (const c of state.clips) if (c.group && count.get(c.group) < 2) c.group = null;
  gcPlayers();
  commit(); renderAll();
  toast(healed ? `Połączono w jeden klip (${plural(healed + 1, 'kawałek', 'kawałki', 'kawałków')} → 1)` : 'Połączono obraz z dźwiękiem w jeden klip');
}

/* Wydzielenie dźwięku filmu na osobny klip; linked = para dalej przesuwa się i tnie razem */
function detachAudio(c, { linked = true, quiet = false } = {}) {
  const m = media.get(c.mediaId);
  if (!m?.hasAudio) { if (!quiet) toast('Ten plik nie ma ścieżki dźwiękowej'); return null; }
  let tr = state.tracks.find(t => t.kind === 'audio' && !t.locked && !overlaps(t.id, c.start, clipEnd(c)));
  if (!tr) tr = addTrack('audio', false);
  const a = newClip('audio', tr.id, c.start, c.dur, { mediaId: c.mediaId, in: c.in, speed: c.speed, name: c.name });
  a.props.volume = c.props.volume;
  a.props.fadeIn = c.props.fadeIn; // dźwięk filmu narastał i wygasał razem z obrazem
  a.props.fadeOut = c.props.fadeOut;
  if (c.props.afx) a.props.afx = structuredClone(c.props.afx);
  if (c.kf?.volume) a.kf.volume = structuredClone(c.kf.volume);
  c.props.detached = true;
  if (linked) { c.group ||= uid('g'); a.group = c.group; }
  state.clips.push(a);
  if (!quiet) { commit(); renderAll(); toast('Dźwięk przeniesiony na ścieżkę ' + tr.name); }
  return a;
}
/* „Rozdziel”: obraz i dźwięk zaznaczonych filmów stają się osobnymi klipami, które można edytować niezależnie */
function splitAV() {
  const vids = selectedClips().filter(c => c.kind === 'video' && !isLocked(c));
  if (!vids.length) { toast('Zaznacz klip wideo, którego obraz i dźwięk chcesz rozdzielić'); return; }
  let n = 0;
  for (const c of vids) {
    if (c.props.detached) {
      // dźwięk jest już osobno, ale para była połączona — rozłączamy ją
      const pair = groupMembers(c);
      if (pair.length > 1) { for (const x of pair) x.group = null; n++; }
      continue;
    }
    const a = detachAudio(c, { linked: false, quiet: true });
    if (a) { if (c.group && groupMembers(c).length === 1) c.group = null; sel.add(a.id); n++; }
  }
  if (!n) { toast(vids.some(c => !media.get(c.mediaId)?.hasAudio) ? 'Ten film nie ma dźwięku — nie ma czego rozdzielać' : 'Obraz i dźwięk są już rozdzielone'); return; }
  commit(); renderAll();
  toast(n === 1 ? 'Rozdzielono — obraz i dźwięk to teraz osobne klipy' : `Rozdzielono ${n} klipy — obraz i dźwięk osobno`);
}

/* Rampa prędkości (time remapping z Premiere): klip dzielony na odcinki z płynnie zmienianą prędkością.
   Każdy odcinek gra taki sam kawałek pliku, więc całość pokazuje ten sam materiał, tylko w innym tempie. */
/* f(u, lo, hi): prędkość w chwili u (0–1) przy najwolniej lo i najszybciej hi (ustawienia pod przyciskami rampy).
   Rampy „do 10×” mają tempo na sztywno — to gotowe efekty z montażu dynamicznych filmów. */
const RAMPS = {
  dip: { name: 'Szybko → wolno → szybko', f: (u, lo, hi) => lo + (hi - lo) * Math.pow(Math.abs(2 * u - 1), 1.6) },
  bump: { name: 'Wolno → szybko → wolno', f: (u, lo, hi) => hi - (hi - lo) * Math.pow(Math.abs(2 * u - 1), 1.6) },
  up: { name: 'Przyspieszenie', f: (u, lo, hi) => lo + (hi - lo) * u * u },
  down: { name: 'Hamowanie', f: (u, lo, hi) => hi - (hi - lo) * u * u },
  burst: { name: 'Do 10× i z powrotem', n: 16, f: u => 1 + 9 * Math.pow(Math.sin(Math.PI * u), 2) }, // płynna fala 1× → 10× → 1×
  burstslow: { name: 'Do 10× i slow-motion', n: 16, f: u => (u < 0.5 ? 1 + 9 * Math.pow(Math.sin(Math.PI * u / 0.5), 2) : 1 - 0.65 * smooth(clamp((u - 0.5) / 0.2, 0, 1))) },
};
function rampPrefs() {
  try { const p = JSON.parse(localStorage.getItem('cloudcut-ramp') || '{}'); return { lo: clamp(+p.lo || 0.3, 0.1, 1), hi: clamp(+p.hi || 3, 1.5, 20) }; } catch { return { lo: 0.3, hi: 3 }; }
}
function speedRamp(c, kind, n = RAMPS[kind]?.n || 12) {
  const R = RAMPS[kind];
  if (!R || !isAV(c) || isLocked(c)) return;
  const members = groupMembers(c).filter(x => isAV(x) && Math.abs(x.start - c.start) < EPS && Math.abs(x.dur - c.dur) < EPS);
  const base = Math.abs(c.speed), sign = c.speed < 0 ? -1 : 1;
  const chunk = c.dur * base / n; // tyle pliku gra każdy odcinek
  const { lo, hi } = rampPrefs();
  const speeds = [...Array(n)].map((_, i) => clamp(base * R.f((i + 0.5) / n, lo, hi), SPEED_MIN, SPEED_MAX));
  const total = speeds.reduce((a, s) => a + chunk / s, 0);
  const delta = total - c.dur, oldEnd = clipEnd(c);
  // reszta tych ścieżek przesuwa się o zmianę długości (jak „rozsuń” w Premiere) — razem z połączonymi klipami
  // na innych ścieżkach i tym, co leży za nimi, żeby żadna para obraz+dźwięk się nie rozjechała
  const ids = new Set(members.map(x => x.id));
  const from = new Map(members.map(x => [x.trackId, oldEnd - EPS])); // ścieżka → od kiedy przesuwamy
  const moving = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const y of state.clips) {
      if (moving.has(y) || ids.has(y.id) || !(from.has(y.trackId) && y.start >= from.get(y.trackId))) continue;
      moving.add(y); grew = true;
      for (const g of groupMembers(y)) {
        if (ids.has(g.id) || moving.has(g)) continue;
        if (!from.has(g.trackId) || g.start - EPS < from.get(g.trackId)) { from.set(g.trackId, g.start - EPS); grew = true; }
      }
    }
  }
  if (moving.size && [...moving].some(y => isLocked(y))) { toast('Rampa przesunęłaby klipy na zablokowanej ścieżce — odblokuj ją'); return; }
  for (const y of moving) y.start += delta;
  // skrócenie zostawia przerwę, jeśli przesunięcie w lewo nałożyłoby klipy na wcześniejsze
  const movedIds = new Set([...moving].map(y => y.id));
  if (delta < 0 && [...moving].some(y => y.start < -EPS || overlaps(y.trackId, y.start, clipEnd(y), new Set([...movedIds, ...ids])))) for (const y of moving) y.start -= delta;
  const groups = [...Array(n)].map(() => (members.length > 1 ? uid('g') : null));
  const out = [];
  const oldSeg = chunk / base; // długość odcinka przed rampą (w czasie osi)
  for (const x of members) {
    let t = x.start;
    let rest = structuredClone(x.kf || {});
    state.clips = state.clips.filter(y => y.id !== x.id);
    for (let i = 0; i < n; i++) {
      const p = structuredClone(x);
      p.id = uid('c');
      p.start = t; p.dur = chunk / speeds[i]; p.speed = sign * speeds[i];
      p.in = x.in + sign * chunk * i;
      // animacja (klatki kluczowe) zostaje: każdy odcinek dostaje swój kawałek, rozciągnięty do nowej długości
      let seg = rest;
      if (i < n - 1) [seg, rest] = splitKf(rest, oldSeg);
      p.kf = seg;
      scaleKf(p, base / speeds[i]);
      p.group = groups[i];
      if (i > 0) { p.props.fadeIn = 0; if (isTransition(p.props.inType)) p.props.inType = 'fade'; }
      if (i < n - 1) p.props.fadeOut = 0;
      p.name = (x.name || clipLabel(x)) + (i ? '' : ' (rampa)');
      t += p.dur;
      state.clips.push(p);
      out.push(p);
    }
  }
  sel = new Set(out.map(x => x.id));
  commit(); renderAll();
  toast(`Rampa „${R.name}”: ${shortDur(c.dur)} → ${shortDur(total)}. Cofnij: ${keyLabel('undo')}`, 4500);
}

/* Zmiana prędkości, także na ujemną (wstecz). Klip zachowuje ten sam fragment pliku, a jego początek zostaje w miejscu.
   base: klipy sprzed przeciągania suwaka — ruch tam i z powrotem nie skraca wtedy klipu na stałe */
function setSpeed(c, s, base = null) {
  s = (s < 0 ? -1 : 1) * clamp(Math.abs(s) || 1, SPEED_MIN, SPEED_MAX);
  const members = groupMembers(c);
  const plans = [];
  for (const x of members) {
    if (!isAV(x)) continue;
    const o = base?.get(x.id) || x;
    const span = o.dur * Math.abs(o.speed), lo = o.speed > 0 ? o.in : o.in - span; // fragment pliku [lo, lo + span]
    const nin = s > 0 ? lo : lo + span;
    let nd = span / Math.abs(s);
    const next = clipsOn(x.trackId).find(y => y.id !== x.id && y.start >= o.start + o.dur - EPS && !members.includes(y));
    if (next) nd = Math.min(nd, next.start - o.start);
    const m = media.get(x.mediaId);
    if (m) nd = Math.min(nd, s > 0 ? (m.duration - nin) / s : nin / -s);
    plans.push({ x, o, nin, nd });
  }
  // obraz i dźwięk połączonej pary (ten sam początek i długość) dostają wspólną, najkrótszą długość — inaczej by się rozjechały
  const pairEnd = p => Math.round(p.o.start * 1000) + ':' + Math.round(p.o.dur * 1000);
  const shortest = new Map();
  for (const p of plans) shortest.set(pairEnd(p), Math.min(shortest.get(pairEnd(p)) ?? Infinity, p.nd));
  for (const { x, o, nin } of plans) {
    x.kf = structuredClone(o.kf || {});
    scaleKf(x, Math.abs(o.speed / s));
    x.dur = Math.max(frame(), shortest.get(pairEnd({ o })));
    x.in = nin;
    x.speed = s;
  }
}

function normalizeClip(c) {
  const m = media.get(c.mediaId);
  if (!m?.peak) { toast('Brak danych o głośności tego pliku'); return; }
  const target = c.kind === 'video' && c.props.detached ? groupMembers(c).find(x => x.kind === 'audio') : c;
  if (!target) return;
  const v = Math.round(clamp(0.95 / m.peak, 0, 4) * 100) / 100;
  delete target.kf.volume;
  target.props.volume = v;
  commit(); renderAll();
  toast(`Głośność ustawiona na ${Math.round(v * 100)}% (szczyt −0,4 dB)`);
}

/* Klip wideo pod głowicą (zaznaczony ma pierwszeństwo) i jego klatka jako zdjęcie w mediach */
function videoClipAt(t) {
  const c = selectedClips().find(x => x.kind === 'video' && t >= x.start && t < clipEnd(x));
  return c || state.tracks.filter(tr => tr.kind === 'video' && !tr.hidden).map(tr => clipsOn(tr.id).find(x => x.kind === 'video' && t >= x.start && t < clipEnd(x))).find(Boolean);
}
/* Klatka filmu w chwili t jako obraz */
async function frameCanvas(c, t) {
  const src = srcTimeOf(c, t), m = media.get(c.mediaId);
  // dokładna klatka prosto z dekodera (odtwarzacz tuż po przewinięciu potrafi oddać jeszcze poprzednią)
  let frame = null;
  try {
    const mb = await loadMediabunny();
    const track = await new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS }).getPrimaryVideoTrack();
    if (track && await track.canDecode()) frame = (await new mb.CanvasSink(track).getCanvas(src))?.canvas || null;
  } catch { /* zostaje odtwarzacz */ }
  if (!frame) { const p = getPlayer(c); await seekTo(p.el, src); frame = p.el; }
  const cv = document.createElement('canvas');
  cv.width = frame.videoWidth || frame.width; cv.height = frame.videoHeight || frame.height;
  cv.getContext('2d').drawImage(frame, 0, 0);
  return cv;
}
async function frameAsMedia(c, t) {
  const cv = await frameCanvas(c, t);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return importBlob(blob, `${clipLabel(c)} — stopklatka ${tc(t)}.png`);
}
/* Zamrożenie od głowicy do końca klipu (jak „Add Frame Hold” w Premiere): obraz stoi, dźwięk filmu gra dalej */
async function freezeRest() {
  const t = playhead;
  const c = videoClipAt(t);
  if (!c) { toast('Ustaw głowicę na klipie wideo'); return; }
  if (isLocked(c)) { toast('Ścieżka tego klipu jest zablokowana'); return; }
  const m = await frameAsMedia(c, t);
  if (!m) return;
  const r = t > c.start + EPS ? splitClip(c, t) : c; // prawa część od głowicy
  if (r !== c && c.group) r.group = null;
  if (media.get(r.mediaId)?.hasAudio && !r.props.detached) detachAudio(r, { linked: false, quiet: true }); // dźwięk zostaje jako osobny klip
  const img = newClip('image', r.trackId, r.start, r.dur, { mediaId: m.id, name: m.name });
  img.props = { ...structuredClone(r.props), fadeIn: 0, inType: 'fade' };
  delete img.props.volume; delete img.props.detached; delete img.props.afx;
  img.kf = structuredClone(r.kf || {});
  delete img.kf.volume;
  state.clips = state.clips.filter(x => x.id !== r.id);
  state.clips.push(img);
  sel = new Set([img.id]);
  commit(); renderAll();
  toast(`Zamrożono obraz od ${tc(t)} do końca klipu (${shortDur(img.dur)})`);
}
/* Przycisk „Zamroź” na pasku: wybór rodzaju zamrożenia */
function freezeMenu(btn) {
  const r = btn.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: 'Stopklatka 2 s — wstaw i rozsuń resztę', key: keyLabel('freeze'), act: () => freezeFrame() },
    { label: 'Stopklatka o wybranej długości…', act: async () => { const v = await ask('Długość stopklatki (sekundy)', '3', { ok: 'Wstaw' }); const d = parseFloat(String(v).replace(',', '.')); if (d > 0) freezeFrame(Math.min(600, d)); } },
    { label: 'Zamroź od głowicy do końca klipu', act: freezeRest },
  ]);
}
async function freezeFrame(d = 2) {
  const t = playhead;
  const c = videoClipAt(t);
  if (!c) { toast('Ustaw głowicę na klipie wideo'); return; }
  const m = await frameAsMedia(c, t);
  if (!m) return;
  rippleInsert(t, d);
  const img = newClip('image', c.trackId, t, d, { mediaId: m.id, name: m.name });
  img.props = { ...structuredClone(c.props), fadeIn: 0, fadeOut: 0, inType: 'fade', outType: 'fade' };
  delete img.props.volume; delete img.props.detached;
  state.clips.push(img);
  sel = new Set([img.id]);
  commit(); renderAll();
  toast(`Wstawiono stopklatkę (${shortDur(d)})`);
}

/* Q / W — przycięcie początku lub końca do głowicy z zsunięciem reszty */
function rippleTrim(side) {
  const t = playhead;
  let targets = state.clips.filter(c => t > c.start + EPS && t < clipEnd(c) - EPS && !isLocked(c));
  if (sel.size) { const s = targets.filter(c => sel.has(c.id)); if (s.length) targets = s; }
  if (!targets.length) { toast('Ustaw głowicę na klipie'); return; }
  for (const c of targets) {
    if (side === 'start') {
      const amount = t - c.start, s0 = c.start;
      trimStartTo(c, t);
      c.start = s0;
      for (const o of state.clips) if (o.trackId === c.trackId && o !== c && o.start >= t - EPS) o.start -= amount;
    } else {
      const amount = clipEnd(c) - t, end0 = clipEnd(c);
      c.dur -= amount;
      for (const o of state.clips) if (o.trackId === c.trackId && o !== c && o.start >= end0 - EPS) o.start -= amount;
    }
  }
  if (side === 'start') seek(Math.min(...targets.map(c => c.start)));
  commit(); renderAll();
}

function closeGapAt(trackId, t) {
  const list = clipsOn(trackId);
  const prevEnd = Math.max(0, ...list.filter(c => clipEnd(c) <= t + EPS).map(clipEnd));
  const next = list.find(c => c.start >= t - EPS);
  if (!next) return;
  const gap = next.start - prevEnd;
  if (gap <= EPS) return;
  for (const c of list) if (c.start >= next.start - EPS) c.start -= gap;
  commit(); renderAll();
}

function addTrack(kind, doCommit = true) {
  const n = state.tracks.filter(t => t.kind === kind).length + 1;
  const tr = mkTrack(uid('t'), kind, ({ video: 'V', audio: 'A', text: 'T', note: 'K' }[kind]) + n);
  if (kind === 'audio') state.tracks.push(tr);
  else if (kind === 'note') state.tracks.unshift(tr); // komentarze na samej górze
  else if (kind === 'text') state.tracks.splice(state.tracks.filter(t => t.kind === 'note').length, 0, tr);
  else {
    const i = state.tracks.findIndex(t => t.kind === 'video');
    state.tracks.splice(i < 0 ? state.tracks.length : i, 0, tr); // nowe wideo ląduje na wierzchu
  }
  if (doCommit) { commit(); renderAll(); }
  return tr;
}
function removeTrack(id) {
  const tr = state.tracks.find(t => t.id === id);
  const n = state.clips.filter(c => c.trackId === id).length;
  if (n && !confirm(`Ścieżka ${tr.name} zawiera ${n} klipów. Usunąć ją razem z nimi?`)) return;
  state.clips = state.clips.filter(c => c.trackId !== id);
  state.tracks = state.tracks.filter(t => t.id !== id);
  gcPlayers();
  commit(); renderAll();
}

function addMarker(t = playhead) {
  const ex = state.markers.find(m => Math.abs(m.t - t) < frame() / 2);
  if (ex) { toast('W tym miejscu już jest znacznik'); return; }
  state.markers.push({ id: uid('k'), t, label: '' });
  state.markers.sort((a, b) => a.t - b.t);
  commit(); drawRuler();
}
/* Rozdziały YouTube ze znaczników: lista „0:00 Tytuł” do wklejenia w opis filmu.
   YouTube wymaga rozdziału od 0:00, co najmniej trzech i każdego dłuższego niż 10 s. */
const chapTime = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`; };
function chaptersText() {
  const list = state.markers.filter(m => m.t < projectEnd()).map((m, i) => ({ t: m.t, label: (m.label || '').trim() || `Rozdział ${i + 1}` }));
  if (!list.length || list[0].t >= 1) list.unshift({ t: 0, label: 'Wstęp' });
  else list[0].t = 0;
  const warn = [];
  if (list.length < 3) warn.push('YouTube pokaże rozdziały dopiero od trzech — dodaj znaczniki (M) na początku kolejnych części.');
  const short = list.filter((c, i) => ((list[i + 1]?.t ?? projectEnd()) - c.t) < 10);
  if (short.length) warn.push(`Za krótkie (poniżej 10 s): ${short.map(c => `„${c.label}”`).join(', ')} — YouTube wymaga co najmniej 10 s.`);
  if (state.markers.some(m => !m.label)) warn.push('Znaczniki bez nazwy dostały „Rozdział n” — nazwę zmienisz prawym przyciskiem na znaczniku.');
  return { text: list.map(c => `${chapTime(c.t)} ${c.label}`).join('\n'), warn };
}
let chapDlg = null;
function showChapters() {
  if (!chapDlg) {
    chapDlg = document.createElement('dialog');
    chapDlg.className = 'dlg';
    chapDlg.setAttribute('aria-labelledby', 'chapTitle');
    chapDlg.innerHTML = `<h2 id="chapTitle">Rozdziały YouTube</h2>
      <p class="hint">Lista powstała ze znaczników na osi czasu. Wklej ją w opis filmu na YouTube.</p>
      <label class="sr-only" for="chapText">Rozdziały</label>
      <textarea id="chapText" rows="9" readonly spellcheck="false"></textarea>
      <div id="chapWarn" class="chap-warn"></div>
      <div class="dlg-actions"><button type="button" class="btn" id="chapClose">Zamknij</button><button type="button" class="btn primary" id="chapCopy">Kopiuj</button></div>`;
    document.body.appendChild(chapDlg);
    $('#chapClose').addEventListener('click', () => chapDlg.close());
    $('#chapCopy').addEventListener('click', async () => {
      const ta = $('#chapText');
      try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
      toast('Skopiowano rozdziały — wklej je w opis filmu');
    });
  }
  const { text, warn } = chaptersText();
  $('#chapText').value = text;
  $('#chapWarn').innerHTML = warn.map(w => `<p class="hint">⚠ ${esc(w)}</p>`).join('');
  chapDlg.showModal();
  $('#chapCopy').focus();
}
function setRangeMark(which) {
  const r = state.range || { in: 0, out: projectEnd() };
  r[which] = playhead;
  if (r.out <= r.in) { if (which === 'in') r.out = Math.max(projectEnd(), r.in + 1); else r.in = 0; }
  state.range = r;
  commit(); drawRuler();
}

function jumpEdit(dir) {
  const pts = [...new Set([0, ...state.clips.flatMap(c => [c.start, clipEnd(c)]), ...state.markers.map(m => m.t)])].sort((a, b) => a - b);
  const t = dir > 0 ? pts.find(p => p > playhead + EPS) : [...pts].reverse().find(p => p < playhead - EPS);
  if (t !== undefined) seek(t);
}

/* =========================================================
   Rysowanie osi czasu
   ========================================================= */
function laneHeight(tr) { return tr.kind === 'text' || tr.kind === 'note' ? TEXT_H : 58; }

function renderHeads() {
  headsEl.innerHTML = `<div class="tl-head-spacer">${state.range ? `I–O ${shortDur(state.range.out - state.range.in)}` : ''}</div>` + state.tracks.map(tr => {
    const color = { video: 'var(--c-video)', audio: 'var(--c-audio)', text: 'var(--c-text)', note: 'var(--c-note)' }[tr.kind];
    const b = [];
    if (tr.kind === 'video' || tr.kind === 'text') b.push(`<button class="icon-btn" data-act="hidden" aria-pressed="${tr.hidden}" aria-label="Ukryj ścieżkę ${esc(tr.name)}" title="Ukryj ścieżkę">${ICON.eye}</button>`);
    if (isAudible(tr)) b.push(`<button class="icon-btn" data-act="muted" aria-pressed="${tr.muted}" aria-label="Wycisz ścieżkę ${esc(tr.name)}" title="Wycisz ścieżkę">${ICON.speaker}</button>`);
    if (tr.kind === 'audio') b.push(`<button class="icon-btn solo" data-act="solo" aria-pressed="${tr.solo}" aria-label="Solo ścieżki ${esc(tr.name)}" title="Solo — słychać tylko tę ścieżkę">S</button>`);
    b.push(`<button class="icon-btn" data-act="locked" aria-pressed="${tr.locked}" aria-label="Zablokuj ścieżkę ${esc(tr.name)}" title="Zablokuj ścieżkę">${ICON.lock}</button>`);
    const vol = isAudible(tr) && ((tr.vol ?? 1) !== 1 || (tr.pan ?? 0) !== 0) ? `<span class="tvol" title="Głośność ścieżki ${Math.round((tr.vol ?? 1) * 100)}%, panorama ${Math.round((tr.pan ?? 0) * 100)}">${Math.round((tr.vol ?? 1) * 100)}%</span>` : '';
    return `<div class="tl-head k-${tr.kind}" data-track="${tr.id}"><span class="tname" title="${esc(tr.name)} — prawy przycisk: opcje"><span class="dot" style="background:${color}"></span>${esc(tr.name)}${vol}</span>${b.join('')}</div>`;
  }).join('') + `<div class="tl-head tl-head-add" aria-label="Dodaj ścieżkę">
      <button class="add-tr" data-addtrack="video" title="Dodaj ścieżkę wideo (na wierzch)">+ Wideo</button>
      <button class="add-tr" data-addtrack="audio" title="Dodaj ścieżkę audio">+ Audio</button>
      <button class="add-tr" data-addtrack="text" title="Dodaj ścieżkę napisów">+ Napisy</button>
      <button class="add-tr" data-addtrack="note" title="Dodaj ścieżkę komentarzy — notatki, których nie ma w filmie">+ Komentarze</button></div>`;
}

function clipStyle(c) {
  const m = media.get(c.mediaId);
  let s = `left:${c.start * pps}px;width:${Math.max(3, c.dur * pps)}px;`;
  if ((c.kind === 'video' || c.kind === 'image') && m?.thumb) s += `background-image:url('${m.thumb}');`;
  else if (c.kind === 'color') {
    const P = c.props;
    s += `background-image:${P.grad === 'solid' ? `linear-gradient(${P.c1},${P.c1})` : `linear-gradient(90deg,${P.c1},${P.c2})`};`;
  }
  return s;
}
/* Fala dźwięku na klipie: audio i film z własnym dźwiękiem; przy odtwarzaniu wstecz odbita w poziomie */
function waveHtml(c) {
  const m = media.get(c.mediaId);
  if (!m?.wave || !(c.kind === 'audio' || (c.kind === 'video' && m.hasAudio && !c.props.detached))) return '';
  const s = Math.abs(c.speed), lo = c.speed > 0 ? c.in : c.in + c.dur * c.speed;
  return `<span class="cwave${c.speed < 0 ? ' rev' : ''}" aria-hidden="true" style="background-image:url('${m.wave}');background-size:${m.duration * pps / s}px 100%;background-position:${-lo * pps / s}px 50%"></span>`;
}
function clipHtml(c) {
  const P = c.props;
  const trans = isTransition(P.inType) && P.fadeIn > 0;
  const fi = P.fadeIn > 0 && !trans ? `<span class="fade fade-in" style="width:${Math.min(P.fadeIn, c.dur) * pps}px"></span>` : '';
  const tb = trans ? `<span class="tbadge" style="width:${Math.max(14, Math.min(P.fadeIn, c.dur) * pps)}px" title="Przejście: ${esc(transName(P.inType))} (${P.fadeIn.toFixed(2).replace('.', ',')} s)"><b>${esc(transName(P.inType))}</b></span>` : '';
  const fo = P.fadeOut > 0 ? `<span class="fade fade-out" style="width:${Math.min(P.fadeOut, c.dur) * pps}px"></span>` : '';
  const kfs = kfTimes(c).map(t => `<span class="kfd" style="left:${t * pps}px"></span>`).join('');
  const label = clipLabel(c);
  const icon = c.kind === 'text' ? ICON.text : c.kind === 'note' ? ICON.note : c.group ? ICON.link : '';
  const spd = c.speed !== 1 ? `<span class="spd" title="${c.speed < 0 ? 'Odtwarzanie wstecz' : 'Prędkość'}">${c.speed < 0 ? '◀ ' : ''}${fmtSpeed(Math.abs(c.speed))}×</span>` : '';
  const tags = [P.filter && filterName(P.filter), P.key?.on && 'klucz', P.lut?.id && 'LUT', P.mask?.type && P.mask.type !== 'none' && 'maska', P.afx && Object.entries(P.afx).some(([k, v]) => v && v !== AFX0[k]) && 'efekty audio'].filter(Boolean);
  const fx = tags.length ? ' · ' + tags.join(' · ') : '';
  return `<div class="clip k-${c.kind}${sel.has(c.id) ? ' sel' : ''}${c.off ? ' off' : ''}" data-clip="${c.id}" style="${clipStyle(c)}" title="${esc(label)} — ${shortDur(c.dur)}">
    ${waveHtml(c)}${tb}${fi}${fo}${kfs}<div class="h h-l" data-h="l"></div><span class="clip-name">${icon}${spd}${esc(label)}${fx}</span><div class="h h-r" data-h="r"></div></div>`;
}

function renderLanes() {
  const width = Math.max(scrollEl.clientWidth, (timelineEnd() + 30) * pps);
  inner.style.width = width + 'px';
  rulerEl.style.width = width + 'px';
  lanesEl.innerHTML = state.tracks.map(tr =>
    `<div class="lane${tr.locked ? ' locked' : ''}" data-track="${tr.id}" data-kind="${tr.kind}">${clipsOn(tr.id).map(clipHtml).join('')}</div>`
  ).join('') + '<div class="lane lane-new" data-new="1"><span>Upuść tutaj klip albo plik, żeby utworzyć nową ścieżkę</span></div>';
  paintStrips();
  drawRuler();
  updatePlayheadUI();
  headsEl.scrollTop = scrollEl.scrollTop;
}

function paintStrips() {
  for (const el of lanesEl.querySelectorAll('.clip.k-video')) {
    const c = clipById(el.dataset.clip);
    const m = media.get(c?.mediaId);
    if (!m?.stripImg) continue;
    const h = Math.max(20, el.clientHeight - 2); // ścieżki mają wysokość z ustawień
    const tw = Math.max(8, h * m.w / m.h);
    const wCss = Math.min(c.dur * pps, 8000);
    if (wCss < 4) continue;
    const cv = document.createElement('canvas');
    cv.className = 'strip';
    cv.width = Math.ceil(wCss); cv.height = h;
    cv.style.width = wCss + 'px';
    const g = cv.getContext('2d');
    for (let x = 0; x < wCss; x += tw) {
      const t = c.in + ((x + tw / 2) / pps) * c.speed;
      const i = clamp(Math.floor(t / m.duration * m.stripN), 0, m.stripN - 1);
      g.drawImage(m.stripImg, i * m.stripTw, 0, m.stripTw, m.stripTh, x, 0, tw, h);
    }
    el.style.backgroundImage = 'none';
    el.prepend(cv);
  }
}

function drawRuler() {
  const w = scrollEl.clientWidth, h = 26, dpr = devicePixelRatio || 1;
  if (!w) return;
  rulerCv.width = w * dpr; rulerCv.height = h * dpr; rulerCv.style.width = w + 'px';
  const g = rulerCv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const sl = scrollEl.scrollLeft;
  // zakres I–O
  if (state.range) {
    const a = state.range.in * pps - sl, b = state.range.out * pps - sl;
    g.fillStyle = 'rgba(107,149,255,.22)';
    g.fillRect(a, 0, b - a, h);
    g.fillStyle = '#6b95ff';
    g.fillRect(a, 0, 2, h); g.fillRect(b - 2, 0, 2, h);
  }
  const steps = [1 / state.fps, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const major = steps.find(s => s * pps >= 80) || 7200;
  const minor = major / (major === 15 || major === 30 ? 3 : 5);
  g.font = '500 10px "JetBrains Mono", monospace';
  g.textBaseline = 'top';
  const t0 = Math.floor(sl / pps / minor) * minor, t1 = (sl + w) / pps;
  for (let i = 0, t = t0; t <= t1; i++, t = t0 + i * minor) {
    const x = Math.round(t * pps - sl) + 0.5;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    g.strokeStyle = isMajor ? '#6c7484' : '#353b47';
    g.beginPath(); g.moveTo(x, isMajor ? 12 : 19); g.lineTo(x, h); g.stroke();
    if (isMajor) {
      g.fillStyle = '#a1a8b5';
      let label;
      if (major < 0.1) label = tc(t);
      else {
        const s = Math.round(t * 10) / 10, m = Math.floor(s / 60);
        label = major < 1 ? `${m}:${(s % 60).toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
      }
      g.fillText(label, x + 4, 2);
    }
  }
  // znaczniki
  for (const mk of state.markers) {
    const x = mk.t * pps - sl;
    if (x < -40 || x > w + 40) continue;
    g.fillStyle = '#5fd39b';
    g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x + 6, 9); g.lineTo(x, 15); g.lineTo(x - 6, 9); g.closePath(); g.fill();
    if (mk.label) {
      g.font = '600 10px Inter, sans-serif';
      const tw = g.measureText(mk.label).width;
      g.fillStyle = 'rgba(21,23,28,.9)';
      g.fillRect(x + 8, 1, tw + 8, 13);
      g.fillStyle = '#5fd39b';
      g.fillText(mk.label, x + 12, 2);
      g.font = '500 10px "JetBrains Mono", monospace';
    }
  }
}

function updatePlayheadUI(follow) {
  const x = playhead * pps;
  playheadEl.style.left = x + 'px';
  if (follow) {
    const sl = scrollEl.scrollLeft, vw = scrollEl.clientWidth;
    if (x > sl + vw - 30 || x < sl) scrollEl.scrollLeft = Math.max(0, x - (playing ? 60 : vw / 2));
  }
  updateClock();
}

function renderAll() {
  renderHeads();
  renderLanes();
  renderInspector();
  syncMedia();
  drawFrame();
}

/* Powiększenie osi: suwak w skali logarytmicznej */
const PPS_MIN = 1.5, PPS_MAX = 900;
const ppsToSlider = v => Math.round(Math.log(v / PPS_MIN) / Math.log(PPS_MAX / PPS_MIN) * 1000);
const sliderToPps = v => PPS_MIN * Math.pow(PPS_MAX / PPS_MIN, v / 1000);
function setZoom(v, anchorT = playhead) {
  const ax = anchorT * pps - scrollEl.scrollLeft;
  pps = clamp(v, PPS_MIN, PPS_MAX);
  $('#zoom').value = ppsToSlider(pps);
  paintRange($('#zoom'));
  renderLanes();
  scrollEl.scrollLeft = Math.max(0, anchorT * pps - ax);
  drawRuler();
}
function zoomFit() {
  const end = Math.max(projectEnd(), 5);
  pps = clamp((scrollEl.clientWidth - 40) / end, PPS_MIN, PPS_MAX);
  $('#zoom').value = ppsToSlider(pps);
  paintRange($('#zoom'));
  renderLanes();
  scrollEl.scrollLeft = 0;
  drawRuler();
}

/* =========================================================
   Interakcja
   ========================================================= */
const timeFromX = x => Math.max(0, (x - inner.getBoundingClientRect().left) / pps);

function snapTargets(excludeIds) {
  const pts = [0, playhead, ...state.markers.map(m => m.t)];
  if (state.range) pts.push(state.range.in, state.range.out);
  for (const c of state.clips) if (!excludeIds.has(c.id)) pts.push(c.start, clipEnd(c));
  return pts;
}
function snapTime(t, pts, force) {
  if (!snapOn && !force) return { t, hit: null };
  const tol = 9 / pps;
  let best = null;
  for (const p of pts) if (Math.abs(p - t) <= tol && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
  return best === null ? { t, hit: null } : { t: best, hit: best };
}
function showLine(cls, t) {
  let line = inner.querySelector('.' + cls);
  if (t === null || t === undefined) { line?.remove(); return; }
  if (!line) { line = document.createElement('div'); line.className = cls; inner.appendChild(line); }
  line.style.left = t * pps + 'px';
}

const TOOL_NAMES = { select: 'Zaznaczanie', blade: 'Żyletka', ripple: 'Przycinanie z zsunięciem', roll: 'Przesuwanie cięcia', slip: 'Poślizg treści' };
function setTool(t) {
  tool = t;
  for (const b of $$('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === t);
  scrollEl.classList.toggle('blade', t === 'blade');
  scrollEl.dataset.tool = t;
  if (t !== 'blade') showLine('blade-line', null);
  if (t !== 'select' && t !== 'blade') toast(`Narzędzie: ${TOOL_NAMES[t]}`, 1400);
}
/* Nowa ścieżka pod przeciągany klip albo plik */
function trackForNewLane(kind) {
  const tr = addTrack(laneKind(kind), false);
  renderHeads();
  return tr;
}

let drag = null;
lanesEl.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  closeMenu();
  const clipEl = e.target.closest('.clip');
  const lane = e.target.closest('.lane');
  if (clipEl) {
    const c = clipById(clipEl.dataset.clip);
    if (isLocked(c)) { startMarquee(e); return; }
    if (tool === 'blade') {
      const t = snapTime(timeFromX(e.clientX), snapTargets(new Set()), e.shiftKey).t;
      splitAt(t, e.altKey ? [c] : groupMembers(c));
      return;
    }
    const members = e.altKey ? [c] : groupMembers(c);
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const on = !sel.has(c.id);
      for (const m of members) on ? sel.add(m.id) : sel.delete(m.id);
    } else if (e.altKey || !sel.has(c.id)) sel = new Set(members.map(m => m.id));
    let mode = e.target.dataset.h === 'l' ? 'trimL' : e.target.dataset.h === 'r' ? 'trimR' : 'move';
    let moving, pair = null;
    if (mode === 'move' && tool === 'slip') {
      if (!isAV(c)) { toast('Poślizg działa na klipach wideo i audio'); return; }
      mode = 'slip';
      moving = members.filter(x => !isLocked(x) && isAV(x));
    } else if (mode !== 'move' && tool === 'roll') {
      // przesuwanie cięcia między dwoma stykającymi się klipami
      const A = mode === 'trimR' ? c : state.clips.find(x => x.trackId === c.trackId && x !== c && Math.abs(clipEnd(x) - c.start) < 0.002);
      const B = mode === 'trimR' ? state.clips.find(x => x.trackId === c.trackId && x !== c && Math.abs(x.start - clipEnd(c)) < 0.002) : c;
      if (A && B) {
        // to samo cięcie w połączonych klipach (np. dźwięk pod obrazem) przesuwa się razem — inaczej A/V się rozjedzie
        const edge = clipEnd(A);
        const pairs = [];
        for (const a2 of (e.altKey ? [A] : groupMembers(A))) {
          if (Math.abs(clipEnd(a2) - edge) > 0.002 || isLocked(a2)) continue;
          const b2 = state.clips.find(x => x.trackId === a2.trackId && x !== a2 && Math.abs(x.start - edge) < 0.002);
          if (b2) pairs.push([a2, b2]);
        }
        mode = 'roll'; pair = pairs; moving = pairs.flat();
      }
    }
    if (!moving) {
      if (mode === 'move') moving = selectedClips().filter(x => !isLocked(x));
      else moving = members.filter(x => !isLocked(x) && (mode === 'trimL' ? Math.abs(x.start - c.start) < EPS : Math.abs(clipEnd(x) - clipEnd(c)) < EPS));
      if (!moving.includes(c)) moving.push(c);
    }
    if ((mode === 'trimL' || mode === 'trimR') && tool === 'ripple') mode = mode === 'trimL' ? 'rippleL' : 'rippleR';
    drag = { mode, c, moving, pair, ids: new Set(moving.map(x => x.id)), orig: new Map(moving.map(x => [x.id, structuredClone(x)])), x0: e.clientX, moved: false };
    if (mode === 'rippleL' || mode === 'rippleR') {
      // klipy za przycinanym miejscem na tych samych ścieżkach — przesuną się razem z krawędzią
      drag.later = new Map();
      for (const x of moving) for (const y of state.clips) if (y.trackId === x.trackId && !drag.ids.has(y.id) && y.start >= clipEnd(x) - EPS) drag.later.set(y.id, y.start);
    }
    drag.pts = snapTargets(drag.ids);
    renderLanes(); renderInspector(); drawFrame();
    e.preventDefault();
    return;
  }
  if (lane) startMarquee(e);
});

function startMarquee(e) {
  const x0 = e.clientX, y0 = e.clientY;
  const ir = inner.getBoundingClientRect();
  let box = null;
  const base = e.shiftKey || e.ctrlKey ? new Set(sel) : new Set();
  const mv = ev => {
    if (!box && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    if (!box) { box = document.createElement('div'); box.className = 'marquee'; inner.appendChild(box); }
    const l = Math.min(x0, ev.clientX) - ir.left, t = Math.min(y0, ev.clientY) - ir.top;
    const w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0);
    Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
    const r = box.getBoundingClientRect();
    sel = new Set(base);
    for (const el of lanesEl.querySelectorAll('.clip')) {
      const cr = el.getBoundingClientRect();
      const c = clipById(el.dataset.clip);
      if (!isLocked(c) && cr.right > r.left && cr.left < r.right && cr.bottom > r.top && cr.top < r.bottom) sel.add(c.id);
    }
    for (const el of lanesEl.querySelectorAll('.clip')) el.classList.toggle('sel', sel.has(el.dataset.clip));
  };
  const up = ev => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    if (box) { box.remove(); renderLanes(); renderInspector(); drawFrame(); return; }
    if (!base.size) sel.clear();
    seek(timeFromX(ev.clientX));
    renderLanes(); renderInspector(); drawFrame();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

window.addEventListener('pointermove', e => {
  if (!drag) {
    if (tool === 'blade' && e.target.closest?.('#tlLanes')) showLine('blade-line', snapTime(timeFromX(e.clientX), snapTargets(new Set()), e.shiftKey).t);
    return;
  }
  const { c, mode, orig, moving, ids } = drag;
  const dx = (e.clientX - drag.x0) / pps;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 4) {
    const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lane');
    if (mode !== 'move' || !lane || lane.dataset.track === c.trackId) return;
  }
  drag.moved = true;
  const oc = orig.get(c.id);
  let hit = null;

  if (mode === 'move') {
    let d = dx;
    const minStart = Math.min(...moving.map(x => orig.get(x.id).start));
    d = Math.max(d, -minStart);
    const s = oc.start + d;
    const a = snapTime(s, drag.pts, e.shiftKey), b = snapTime(s + oc.dur, drag.pts, e.shiftKey);
    if (a.hit !== null && (b.hit === null || Math.abs(a.t - s) <= Math.abs(b.t - (s + oc.dur)))) { d = a.t - oc.start; hit = a.hit; }
    else if (b.hit !== null) { d = b.t - oc.dur - oc.start; hit = b.hit; }
    d = Math.max(d, -minStart);
    let target = oc.trackId;
    const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lane');
    if (lane?.dataset.new) {
      // przeciągnięcie na pas „nowa ścieżka” tworzy (raz) ścieżkę pasującą do klipu
      drag.newTrack ||= trackForNewLane(c.kind).id;
      target = drag.newTrack;
    } else if (lane && lane.dataset.kind === laneKind(c.kind) && !state.tracks.find(t => t.id === lane.dataset.track)?.locked) target = lane.dataset.track;
    const valid = tgt => moving.every(x => {
      const o = orig.get(x.id);
      const tid = x === c ? tgt : o.trackId;
      return !overlaps(tid, o.start + d, o.start + d + o.dur, ids);
    });
    let tgt = valid(target) ? target : valid(c.trackId) ? c.trackId : valid(oc.trackId) ? oc.trackId : null;
    if (tgt !== null) {
      const changed = tgt !== c.trackId;
      for (const x of moving) { const o = orig.get(x.id); x.start = o.start + d; if (x === c) x.trackId = tgt; }
      if (changed) { renderLanes(); for (const x of moving) lanesEl.querySelector(`[data-clip="${x.id}"]`)?.classList.add('dragging'); }
    }
  } else if (mode === 'slip') {
    // poślizg: klip stoi w miejscu, przesuwa się treść w jego środku
    for (const x of moving) {
      const o = orig.get(x.id), m = media.get(o.mediaId);
      if (!m) continue;
      const span = o.dur * Math.abs(o.speed), ni = o.in - dx * o.speed; // wstecz: c.in to koniec użytego fragmentu pliku
      x.in = o.speed > 0 ? clamp(ni, 0, Math.max(0, m.duration - span)) : clamp(ni, Math.min(span, m.duration), m.duration);
    }
    toast(`Początek w pliku: ${tc(c.in)}`, 700);
  } else if (mode === 'roll') {
    const [A0] = drag.pair[0], edge = orig.get(A0.id).start + orig.get(A0.id).dur;
    const sn = snapTime(edge + dx, drag.pts, e.shiftKey);
    hit = sn.hit;
    let lo = -Infinity, hi = Infinity;
    for (const [A, B] of drag.pair) {
      const oA = orig.get(A.id), oB = orig.get(B.id), mA = media.get(oA.mediaId);
      lo = Math.max(lo, oA.start + frame()); hi = Math.min(hi, oB.start + oB.dur - frame());
      if (isAV(oA) && mA) hi = Math.min(hi, clipEnd(oA) + roomAfter(oA, mA));
      if (isAV(oB)) lo = Math.max(lo, oB.start - roomBefore(oB, media.get(oB.mediaId)));
    }
    const cut = clamp(sn.t, lo, hi);
    for (const [A, B] of drag.pair) {
      const oA = orig.get(A.id), oB = orig.get(B.id);
      A.dur = cut - oA.start;
      const d = cut - oB.start;
      B.start = cut; B.in = oB.in + d * oB.speed; B.dur = oB.dur - d;
      B.kf = structuredClone(oB.kf); shiftKf(B, -d);
    }
    if (!playing) seek(cut);
  } else if (mode === 'rippleL' || mode === 'rippleR') {
    const isL = mode === 'rippleL';
    let d = dx, lo = -Infinity, hi = Infinity;
    for (const x of moving) {
      const o = orig.get(x.id), m = media.get(o.mediaId);
      if (isL) { hi = Math.min(hi, o.dur - frame()); if (isAV(o)) lo = Math.max(lo, -roomBefore(o, m)); }
      else { lo = Math.max(lo, frame() - o.dur); if (isAV(o) && m) hi = Math.min(hi, roomAfter(o, m)); }
    }
    d = clamp(d, lo, hi);
    for (const x of moving) {
      const o = orig.get(x.id);
      if (isL) { x.in = o.in + d * o.speed; x.dur = o.dur - d; x.kf = structuredClone(o.kf); shiftKf(x, -d); }
      else x.dur = o.dur + d;
    }
    const shift = isL ? -d : d;
    for (const [id, s0] of drag.later) { const y = clipById(id); if (y) y.start = Math.max(0, s0 + shift); }
    renderLanes();
    for (const x of moving) lanesEl.querySelector(`[data-clip="${x.id}"]`)?.classList.add('dragging');
  } else {
    const isL = mode === 'trimL';
    const edge = isL ? oc.start : oc.start + oc.dur;
    const sn = snapTime(edge + dx, drag.pts, e.shiftKey);
    hit = sn.hit;
    let d = sn.t - edge, lo = -Infinity, hi = Infinity;
    for (const x of moving) {
      const o = orig.get(x.id);
      const m = media.get(o.mediaId);
      const others = clipsOn(o.trackId).filter(y => !ids.has(y.id));
      if (isL) {
        hi = Math.min(hi, o.dur - frame());
        const prevEnd = Math.max(0, ...others.filter(y => clipEnd(y) <= o.start + EPS).map(clipEnd));
        lo = Math.max(lo, prevEnd - o.start);
        if (isAV(o)) lo = Math.max(lo, -roomBefore(o, m));
      } else {
        lo = Math.max(lo, frame() - o.dur);
        const next = others.find(y => y.start >= o.start + o.dur - EPS);
        if (next) hi = Math.min(hi, next.start - (o.start + o.dur));
        if (isAV(o) && m) hi = Math.min(hi, roomAfter(o, m));
      }
    }
    d = clamp(d, lo, hi);
    for (const x of moving) {
      const o = orig.get(x.id);
      if (isL) {
        x.start = o.start + d; x.in = o.in + d * o.speed; x.dur = o.dur - d;
        x.kf = structuredClone(o.kf); shiftKf(x, -d);
      } else x.dur = o.dur + d;
    }
  }
  showLine('snap-line', hit);
  for (const x of moving) {
    const el = lanesEl.querySelector(`[data-clip="${x.id}"]`);
    if (el) {
      el.style.cssText = clipStyle(x); el.classList.add('dragging'); el.querySelector('.strip')?.remove();
      const w = el.querySelector('.cwave');
      if (w) w.outerHTML = waveHtml(x);
    }
  }
  if (!playing) { syncMedia(); drawFrame(); }
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const moved = drag.moved, nt = drag.newTrack;
  drag = null;
  showLine('snap-line', null);
  // pusta ścieżka utworzona w trakcie przeciągania, a klip ostatecznie trafił gdzie indziej
  if (nt && !state.clips.some(c => c.trackId === nt)) state.tracks = state.tracks.filter(t => t.id !== nt);
  if (moved || nt) { commit(); renderAll(); }
});

/* Przewijanie głowicą po linijce */
rulerEl.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  closeMenu();
  scrubbing = true;
  const pts = snapTargets(new Set());
  const at = ev => seek(snapTime(timeFromX(ev.clientX), pts, ev.shiftKey).t);
  at(e);
  const up = () => {
    scrubbing = false;
    window.removeEventListener('pointermove', at);
    window.removeEventListener('pointerup', up);
    syncMedia(); drawFrame();
  };
  window.addEventListener('pointermove', at);
  window.addEventListener('pointerup', up);
});
function markerAt(clientX) {
  const t = timeFromX(clientX);
  return state.markers.find(m => Math.abs(m.t - t) * pps < 7);
}
rulerEl.addEventListener('dblclick', e => {
  const mk = markerAt(e.clientX);
  if (mk) renameMarker(mk);
});
async function renameMarker(mk) {
  const v = await ask('Nazwa znacznika', mk.label, { ok: 'Zapisz' });
  if (v === null) return;
  mk.label = v.trim();
  commit(); drawRuler();
}
rulerEl.addEventListener('contextmenu', e => {
  e.preventDefault();
  const mk = markerAt(e.clientX);
  const t = timeFromX(e.clientX);
  const items = [];
  if (mk) {
    items.push({ label: 'Zmień nazwę znacznika', act: () => renameMarker(mk) });
    items.push({ label: 'Usuń znacznik', act: () => { state.markers = state.markers.filter(m => m !== mk); commit(); drawRuler(); } });
    items.push('-');
  }
  items.push({ label: 'Dodaj znacznik tutaj', key: keyLabel('marker'), act: () => addMarker(t) });
  items.push({ label: 'Rozdziały YouTube ze znaczników…', act: showChapters });
  items.push({ label: 'Początek zakresu tutaj', key: keyLabel('markIn'), act: () => { seek(t); setRangeMark('in'); } });
  items.push({ label: 'Koniec zakresu tutaj', key: keyLabel('markOut'), act: () => { seek(t); setRangeMark('out'); } });
  items.push({ label: 'Wyczyść zakres I–O', key: keyLabel('clearRange'), disabled: !state.range, act: () => { state.range = null; commit(); drawRuler(); renderHeads(); } });
  items.push({ label: 'Usuń wszystkie znaczniki', disabled: !state.markers.length, act: () => { state.markers = []; commit(); drawRuler(); } });
  openMenu(e.clientX, e.clientY, items);
});

scrollEl.addEventListener('scroll', () => { headsEl.scrollTop = scrollEl.scrollTop; drawRuler(); });
scrollEl.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    e.preventDefault();
    setZoom(pps * (e.deltaY < 0 ? 1.18 : 1 / 1.18), timeFromX(e.clientX));
  } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && scrollEl.scrollHeight <= scrollEl.clientHeight + 1) {
    e.preventDefault();
    scrollEl.scrollLeft += e.deltaY;
  }
}, { passive: false });

/* Nagłówki ścieżek */
headsEl.addEventListener('click', e => {
  const add = e.target.closest('[data-addtrack]');
  if (add) { const tr = addTrack(add.dataset.addtrack); toast(`Dodano ścieżkę ${tr.name}`, 1400); return; }
  const btn = e.target.closest('[data-act]');
  const head = e.target.closest('.tl-head');
  if (!btn || !head) return;
  const tr = state.tracks.find(t => t.id === head.dataset.track);
  const k = btn.dataset.act;
  tr[k] = !tr[k];
  if (k === 'locked' && tr.locked) for (const c of state.clips) if (c.trackId === tr.id) sel.delete(c.id);
  commit(); renderHeads(); renderLanes(); syncMedia(); drawFrame();
});
function moveTrack(tr, dir) {
  const same = state.tracks.filter(t => t.kind === tr.kind);
  const j = same.indexOf(tr) + dir;
  if (j < 0 || j >= same.length) return;
  const a = state.tracks.indexOf(tr), b = state.tracks.indexOf(same[j]);
  [state.tracks[a], state.tracks[b]] = [state.tracks[b], state.tracks[a]];
  commit(); renderAll();
}
function duplicateTrack(tr) {
  const nt = { ...structuredClone(tr), id: uid('t'), name: tr.name + ' kopia', solo: false };
  state.tracks.splice(state.tracks.indexOf(tr), 0, nt);
  const groups = new Map();
  for (const c of state.clips.filter(x => x.trackId === tr.id)) {
    const d = structuredClone(c);
    d.id = uid('c'); d.trackId = nt.id;
    d.group = null;
    state.clips.push(d);
    groups.set(c.id, d.id);
  }
  commit(); renderAll();
}
headsEl.addEventListener('contextmenu', e => {
  const head = e.target.closest('.tl-head');
  e.preventDefault();
  const tr = head && state.tracks.find(t => t.id === head.dataset.track);
  const items = [];
  if (tr) {
    const same = state.tracks.filter(t => t.kind === tr.kind);
    items.push({ label: `Zmień nazwę ścieżki ${tr.name}`, act: async () => { const v = await ask('Nazwa ścieżki', tr.name, { ok: 'Zapisz' }); if (v?.trim()) { tr.name = v.trim().slice(0, 24); commit(); renderHeads(); } } });
    items.push({ label: 'Przesuń wyżej', disabled: same.indexOf(tr) === 0, act: () => moveTrack(tr, -1) });
    items.push({ label: 'Przesuń niżej', disabled: same.indexOf(tr) === same.length - 1, act: () => moveTrack(tr, 1) });
    items.push({ label: 'Duplikuj ścieżkę z klipami', act: () => duplicateTrack(tr) });
    items.push({ label: 'Zaznacz wszystkie klipy na ścieżce', act: () => { sel = new Set(state.clips.filter(c => c.trackId === tr.id).map(c => c.id)); renderLanes(); renderInspector(); } });
    if (isAudible(tr)) items.push({ label: 'Głośność i panorama (mikser)…', act: () => openMixer() });
    items.push({ label: 'Usuń ścieżkę', disabled: same.length < 2 && tr.kind !== 'note', act: () => removeTrack(tr.id) });
    items.push('-');
  }
  items.push({ label: 'Dodaj ścieżkę wideo', act: () => addTrack('video') });
  items.push({ label: 'Dodaj ścieżkę audio', act: () => addTrack('audio') });
  items.push({ label: 'Dodaj ścieżkę napisów', act: () => addTrack('text') });
  items.push({ label: 'Dodaj ścieżkę komentarzy', act: () => addTrack('note') });
  items.push({ label: 'Mikser audio…', act: () => openMixer() });
  openMenu(e.clientX, e.clientY, items);
});

/* Menu kontekstowe klipów i pustych miejsc */
lanesEl.addEventListener('contextmenu', e => {
  e.preventDefault();
  const clipEl = e.target.closest('.clip');
  const lane = e.target.closest('.lane');
  const t = timeFromX(e.clientX);
  if (clipEl) {
    const c = clipById(clipEl.dataset.clip);
    if (!sel.has(c.id)) { sel = new Set(groupMembers(c).map(x => x.id)); renderLanes(); renderInspector(); drawFrame(); }
    const n = sel.size;
    const items = [
      { label: 'Przetnij w miejscu głowicy', key: keyLabel('split'), act: () => splitAt(playhead) },
      { label: 'Przetnij tutaj', act: () => splitAt(t, groupMembers(c)) },
      '-',
      { label: 'Kopiuj', key: keyLabel('copy'), act: () => copySelected() },
      { label: 'Wytnij', key: keyLabel('cut'), act: () => copySelected(true) },
      { label: 'Wklej w miejscu głowicy', key: keyLabel('paste'), disabled: !clipboard, act: () => paste() },
      { label: 'Duplikuj', key: keyLabel('duplicate'), act: duplicateSelected },
      '-',
      { label: 'Połącz w jeden klip', key: keyLabel('link'), disabled: n < 2, act: joinSelected },
      ...(isVisual(c) ? [{ label: 'Obróć w prawo o 90°', act: () => rotateClips(selectedClips(), 90) }, { label: 'Obróć w lewo o 90°', act: () => rotateClips(selectedClips(), -90) }] : []),
      ...(c.group ? [{ label: 'Rozłącz', key: keyLabel('unlink'), act: unlinkSelected }] : []),
    ];
    if (c.kind === 'video') {
      items.push({ label: 'Rozdziel obraz i dźwięk', key: keyLabel('detach'), disabled: !media.get(c.mediaId)?.hasAudio || (c.props.detached && groupMembers(c).length < 2), act: splitAV });
      items.push({ label: 'Stopklatka w miejscu głowicy (2 s)', key: keyLabel('freeze'), act: () => freezeFrame() });
      items.push({ label: 'Zamroź od głowicy do końca klipu', act: freezeRest });
    }
    if (isAV(c)) {
      items.push({ label: 'Normalizuj głośność', disabled: !media.get(c.mediaId)?.peak, act: () => normalizeClip(c) });
      for (const s of [0.5, 1, 2]) items.push({ label: `Prędkość ${String(s).replace('.', ',')}×`, disabled: c.speed === s, act: () => { setSpeed(c, s); commit(); renderAll(); } });
      items.push({ label: c.speed < 0 ? 'Odtwarzaj do przodu' : 'Odtwarzaj wstecz', act: () => { setSpeed(c, -c.speed); commit(); renderAll(); } });
    }
    if (c.mediaId) items.push({ label: 'Pokaż w monitorze źródła', key: keyLabel('matchFrame'), act: () => openSource(c.mediaId) });
    items.push({ label: c.off ? 'Włącz klip' : 'Wyłącz klip', key: keyLabel('toggleOff'), act: toggleClipsOff });
    items.push({ label: 'Dodaj przejście 0,5 s', key: keyLabel('transition'), act: addDefaultTransition });
    items.push('-');
    items.push({ label: 'Usuń', key: keyLabel('delete'), act: () => deleteSelected(false) });
    items.push({ label: 'Usuń z zsunięciem', key: keyLabel('rippleDelete'), act: () => deleteSelected(true) });
    openMenu(e.clientX, e.clientY, items);
  } else if (lane) {
    const tr = state.tracks.find(x => x.id === lane.dataset.track);
    const list = clipsOn(tr.id);
    const inGap = list.some(c => c.start > t) && !list.some(c => t >= c.start && t < clipEnd(c));
    openMenu(e.clientX, e.clientY, [
      { label: 'Wklej tutaj', disabled: !clipboard, act: () => paste(t) },
      { label: 'Usuń tę przerwę', disabled: !inGap || tr.locked, act: () => closeGapAt(tr.id, t) },
      { label: 'Dodaj znacznik tutaj', act: () => addMarker(t) },
      ...(tr.kind === 'text' ? [{ label: 'Dodaj napis tutaj', act: () => addTextClip(null, t, tr.id) }] : []),
      ...(tr.kind === 'note' ? [{ label: 'Dodaj komentarz tutaj', act: () => addComment(t, tr.id) }] : []),
      ...(tr.kind === 'video' ? [{ label: 'Dodaj czarną planszę tutaj', act: () => addColorClip('black', t, tr.id) }] : []),
    ]);
  }
});

/* Przeciąganie z biblioteki */
const DRAG_TYPES = ['text/x-kadr-media', 'text/x-kadr-title', 'text/x-kadr-solid', 'text/x-kadr-trans', 'text/x-kadr-filter', 'text/x-kadr-asset'];
lanesEl.addEventListener('dragover', e => {
  if (!DRAG_TYPES.some(t => e.dataTransfer.types.includes(t))) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  $$('.lane.drop-ok', lanesEl).forEach(l => l.classList.remove('drop-ok'));
  e.target.closest('.lane')?.classList.add('drop-ok');
  showLine('snap-line', snapTime(timeFromX(e.clientX), snapTargets(new Set()), true).t);
});
lanesEl.addEventListener('dragleave', e => { if (!lanesEl.contains(e.relatedTarget)) { $$('.lane.drop-ok', lanesEl).forEach(l => l.classList.remove('drop-ok')); showLine('snap-line', null); } });
lanesEl.addEventListener('drop', e => {
  const type = DRAG_TYPES.find(t => e.dataTransfer.types.includes(t));
  if (!type) return;
  e.preventDefault();
  e.stopPropagation();
  const id = e.dataTransfer.getData(type);
  const lane = e.target.closest('.lane');
  $$('.lane.drop-ok', lanesEl).forEach(l => l.classList.remove('drop-ok'));
  showLine('snap-line', null);
  const t = snapTime(timeFromX(e.clientX), snapTargets(new Set()), true).t;
  // upuszczenie na pasie „nowa ścieżka” tworzy ścieżkę odpowiedniego rodzaju
  let trackId = lane?.dataset.track;
  if (lane?.dataset.new && type !== 'text/x-kadr-trans' && type !== 'text/x-kadr-filter') {
    const kind = type === 'text/x-kadr-media' ? (media.get(id)?.kind || 'video') : type === 'text/x-kadr-title' ? 'text' : type === 'text/x-kadr-asset' ? assetLaneKind(id) : 'video';
    trackId = addTrack(laneKind(kind), false).id;
  }
  if (type === 'text/x-kadr-media') placeMedia(media.get(id), { t, trackId, mode: e.ctrlKey ? 'insert' : 'overwrite' });
  else if (type === 'text/x-kadr-title') addTextClip(id, t, trackId);
  else if (type === 'text/x-kadr-trans') { if (lane && !lane.dataset.new) dropTransition(id, lane.dataset.track, t); }
  else if (type === 'text/x-kadr-filter') { if (lane && !lane.dataset.new) dropFilter(id, lane.dataset.track, timeFromX(e.clientX)); }
  else if (type === 'text/x-kadr-asset') useAsset(id, t, trackId);
  else addColorClip(id, t, trackId);
});
