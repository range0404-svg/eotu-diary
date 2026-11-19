// ui.js — 에디터 제어 · 어투 거울 역추적 · 슬래시 명령 · 음성 입력 · 블러 · 스트릭 · 검색/달력/설정 모달
import * as S from './storage.js';
import { analyze, toHTML, escapeHTML } from './analyzer.js';
import * as Q from './search.js';
import { buildSamples, SAMPLE_PREFIX } from './samples.js';

// ⚠ 업데이트할 때마다 APP_VERSION과 sw.js의 CACHE를 같은 값으로 올릴 것
export const APP_VERSION = '2.1.0';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const THEMES = ['paper', 'sepia', 'dark'];
const THEME_COLOR = { paper: '#fbfaf7', sepia: '#f3ead6', dark: '#16181d' };

const el = {
  list: $('#diaryList'), date: $('#entryDate'), weekday: $('#entryWeekday'),
  hl: $('#highlightInput'), status: $('#saveStatus'), sealBanner: $('#sealBanner'),
  pin: $('#btnPin'), seal: $('#btnSeal'), copy: $('#btnCopy'), undo: $('#btnUndo'), del: $('#btnDelete'),
  fsLines: $('#fsLines'), mirror: $('#mirror'), stats: $('#mirrorStats'), bars: $('#endingBars'),
  radar: $('#radarToggle'), streak: $('#streak'), sync: $('#syncBadge'), popover: $('#popover'), toast: $('#toast'),
  quickBar: $('#quickBar'), quickInput: $('#quickInput'), mic: $('#btnMic'),
};
const FIELDS = { foreshadow: $('#f-foreshadow'), body: $('#f-body'), footnote: $('#f-footnote') };
const ZONE_EL = { foreshadow: $('#zone-foreshadow'), body: $('#zone-body'), footnote: $('#zone-footnote') };

let currentId = null;
let bodyCaret = { start: 0, end: 0 };
let mirrorTimer = null;
let ready = false;

const cur = () => (currentId ? S.getDiary(currentId) : null);
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const weekdayOf = (ds) => { const [y, m, d] = ds.split('-').map(Number); return WEEK[new Date(y, m - 1, d).getDay()]; };
const isMobile = () => matchMedia('(max-width: 768px)').matches;

// =====================================================================
// 공통 UI
// =====================================================================
let toastTimer;
function toast(msg, ms = 2200) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}
function openModal(id) { closePopover(); $('#' + id).hidden = false; }
function closeModal(id) { $('#' + id).hidden = true; }
function closeAllModals() { $$('.modal').forEach((m) => { m.hidden = true; }); }
const anyModalOpen = () => $$('.modal').some((m) => !m.hidden);

// textarea 안 특정 글자 위치의 세로 좌표 측정 → 화면 스크롤
const measurer = document.createElement('div');
measurer.setAttribute('aria-hidden', 'true');
Object.assign(measurer.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word' });
document.body.appendChild(measurer);
function caretTop(ta, pos) {
  const cs = getComputedStyle(ta);
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'wordBreak']
    .forEach((p) => { measurer.style[p] = cs[p]; });
  measurer.style.borderStyle = 'solid';
  measurer.style.width = ta.offsetWidth + 'px';
  measurer.textContent = ta.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '​';
  measurer.appendChild(mark);
  return mark.offsetTop;
}
function scrollParent(node) {
  for (let p = node.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
function revealInTextarea(ta, pos) {
  const top = caretTop(ta, pos);
  const y = ta.getBoundingClientRect().top + top - ta.scrollTop;
  const sp = scrollParent(ta);
  if (sp) {
    const r = sp.getBoundingClientRect();
    sp.scrollBy({ top: y - r.top - sp.clientHeight / 3, behavior: 'smooth' });
  } else {
    window.scrollBy({ top: y - innerHeight / 3, behavior: 'smooth' });
  }
}
function selectInField(zone, start, end) {
  const ta = FIELDS[zone];
  ZONE_EL[zone].open = true;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  if (zone === 'body') bodyCaret = { start, end };
  revealInTextarea(ta, start);
  ta.classList.remove('flash'); void ta.offsetWidth; ta.classList.add('flash');
}

// =====================================================================
// 테마 · 블러
// =====================================================================
function applyTheme() {
  const t = S.state.settings.theme;
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').setAttribute('content', THEME_COLOR[t]);
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t));
}
function setTheme(t) {
  S.state.settings.theme = t;
  S.saveSettings();
  applyTheme();
}
function toggleBlur(force) {
  const on = document.body.classList.toggle('blurred', force);
  if (on) { closePopover(); document.activeElement && document.activeElement.blur && document.activeElement.blur(); }
  toast(on ? '🙈 블러 잠금 (👁 또는 Esc 2회로 해제)' : '블러 해제', 1400);
}

// =====================================================================
// 목록 · 스트릭
// =====================================================================
function sortDiaries(arr) {
  return [...arr].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
}
const firstLine = (s) => (s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
function titleOf(d) {
  if (d.highlightSentence.trim()) return { text: d.highlightSentence.trim(), hl: true };
  return { text: firstLine(d.body) || firstLine(d.foreshadow) || firstLine(d.footnote) || '(빈 일기)', hl: false };
}
function renderList() {
  const items = sortDiaries(S.liveDiaries());
  if (!items.length) { el.list.innerHTML = '<li class="empty">아직 일기가 없습니다.</li>'; return; }
  el.list.innerHTML = items.map((d) => {
    const t = titleOf(d);
    const badges = (d.pinned ? '📌' : '') + (d.sealed ? '🔒' : '');
    return `<li data-id="${d.id}" class="${d.id === currentId ? 'active' : ''}">
      <span class="d-date">${d.date} (${weekdayOf(d.date)})<span class="badges">${badges}</span></span>
      <span class="d-title ${t.hl ? 'hl' : ''}">${t.hl ? '⭐ ' : ''}${escapeHTML(t.text)}</span>
    </li>`;
  }).join('');
}
const hasContent = (d) => !!(d.foreshadow.trim() || d.body.trim() || d.footnote.trim());
function calcStreak() {
  const days = new Set(S.liveDiaries().filter(hasContent).map((d) => d.date));
  let day = S.todayStr();
  if (!days.has(day)) day = S.addDays(day, -1);
  let n = 0;
  while (days.has(day)) { n++; day = S.addDays(day, -1); }
  return n;
}
function renderStreak() {
  const n = calcStreak();
  el.streak.textContent = `🔥 ${n}일`;
  el.streak.title = n ? `${n}일 연속 기록 중` : '오늘 첫 기록을 남겨 보세요';
  el.streak.classList.toggle('hot', n >= 3);
}

// =====================================================================
// 에디터
// =====================================================================
function openDiary(id) {
  if (currentId && currentId !== id) S.flushSave(currentId);
  const d = S.getDiary(id);
  if (!d) return;
  currentId = id;
  S.markBaseline(d);
  fillEditor();
  renderList();
  if (isMobile()) document.body.classList.remove('side-open');
}
function fillEditor() {
  const d = cur();
  if (!d) return;
  for (const [z, ta] of Object.entries(FIELDS)) { ta.value = d[z]; autoGrow(ta); }
  el.date.value = d.date;
  el.weekday.textContent = weekdayOf(d.date) + '요일';
  el.hl.value = d.highlightSentence;
  bodyCaret = { start: d.body.length, end: d.body.length };
  el.status.textContent = '';
  renderMeta();
  renderFsLines();
  renderMirror();
}
function renderMeta() {
  const d = cur();
  if (!d) return;
  const sealed = d.sealed;
  document.body.classList.toggle('sealed', sealed);
  Object.values(FIELDS).forEach((ta) => { ta.readOnly = sealed; });
  el.hl.readOnly = sealed;
  el.date.disabled = sealed;
  $('#btnPickHighlight').disabled = sealed;
  el.del.disabled = sealed;
  el.pin.classList.toggle('on', d.pinned);
  el.pin.title = d.pinned ? '핀 고정 해제' : '목록 상단에 핀 고정';
  el.seal.textContent = sealed ? '🔒 봉인됨' : '봉인';
  el.seal.classList.toggle('on', sealed);
  el.undo.disabled = sealed || !S.canUndo(d.id);
  el.sealBanner.hidden = !sealed;
  if (sealed) el.sealBanner.textContent = `🔒 채증 원본 봉인 — ${d.sealedAt} 이후 읽기 전용입니다. [🔒 봉인됨]을 눌러 해제할 수 있습니다.`;
}
function onSaved() {
  el.status.textContent = `저장됨 ${hhmm()}`;
  renderList();
  renderStreak();
  const d = cur();
  if (d) el.undo.disabled = d.sealed || !S.canUndo(d.id);
}
function touch(d) {
  el.status.textContent = '입력 중…';
  S.scheduleSave(d, onSaved);
}
function onFieldInput(zone) {
  const d = cur();
  const ta = FIELDS[zone];
  autoGrow(ta);
  if (!d || d.sealed) return;
  d[zone] = ta.value;
  touch(d);
  if (zone === 'body') {
    bodyCaret = { start: ta.selectionStart, end: ta.selectionEnd };
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(renderMirror, 180);
  }
  if (zone === 'foreshadow') renderFsLines();
}

// ---------- 슬래시 명령어 ----------
const SLASH = [
  ['/지금', () => `[${hhmm()}] `],
  ['/업무', () => '#업무 '],
  ['/할일', () => '[ ] '],
];
function handleSlash(ta) {
  if (ta.readOnly) return false;
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return false;
  const before = ta.value.slice(0, pos);
  for (const [cmd, fn] of SLASH) {
    if (before.endsWith(cmd)) {
      ta.setRangeText(fn(), pos - cmd.length, pos, 'end');
      onFieldInput(ta.dataset.zone);
      return true;
    }
  }
  return false;
}

// ---------- 복선 체크박스 · 본문으로 끌어오기 ----------
const CHECK_RE = /^(\s*(?:[-*]\s*)?)\[( |x|X)\]\s?/;
function renderFsLines() {
  const d = cur();
  if (!d) { el.fsLines.innerHTML = ''; return; }
  const lines = d.foreshadow.split('\n');
  el.fsLines.innerHTML = lines.map((line, i) => {
    if (!line.trim()) return '';
    const m = line.match(CHECK_RE);
    const done = m && m[2].toLowerCase() === 'x';
    const text = m ? line.slice(m[0].length) : line.replace(/^\s*[-*]\s*/, '');
    const box = m ? `<input type="checkbox" data-i="${i}" ${done ? 'checked' : ''} ${d.sealed ? 'disabled' : ''} aria-label="완료 체크">` : '<span>·</span>';
    return `<li class="${done ? 'done' : ''}">${box}<span class="t">${escapeHTML(text) || '&nbsp;'}</span>
      <button class="pull" data-i="${i}" title="본문 커서 위치로 끌어오기" ${d.sealed ? 'disabled' : ''}>↓</button></li>`;
  }).join('');
}
function toggleCheck(i) {
  const d = cur();
  if (!d || d.sealed) return;
  const lines = d.foreshadow.split('\n');
  const m = lines[i] && lines[i].match(CHECK_RE);
  if (!m) return;
  const next = m[2] === ' ' ? 'x' : ' ';
  lines[i] = m[1] + `[${next}] ` + lines[i].slice(m[0].length);
  d.foreshadow = lines.join('\n');
  FIELDS.foreshadow.value = d.foreshadow;
  touch(d);
  renderFsLines();
}
function pullToBody(i) {
  const d = cur();
  if (!d || d.sealed) return;
  const line = d.foreshadow.split('\n')[i];
  if (!line) return;
  const text = line.replace(CHECK_RE, '').replace(/^\s*[-*]\s*/, '').trim();
  if (!text) return;
  const ta = FIELDS.body;
  const { start, end } = bodyCaret;
  const pre = ta.value.slice(0, start);
  const insert = (pre && !pre.endsWith('\n') ? '\n' : '') + text + '\n';
  ta.setRangeText(insert, start, end, 'end');
  ZONE_EL.body.open = true;
  onFieldInput('body');
  ta.focus({ preventScroll: true });
  revealInTextarea(ta, ta.selectionStart);
  toast('↓ 본문에 끌어왔습니다');
}

// ---------- 대표 문장 ----------
function sentenceAt(text, pos) {
  const isStop = (c) => /[.!?。\n]/.test(c);
  let a = pos;
  while (a > 0 && !isStop(text[a - 1])) a--;
  let b = pos;
  while (b < text.length && !isStop(text[b])) b++;
  if (b < text.length && text[b] !== '\n') b++;
  return text.slice(a, b).trim();
}
function pickHighlight() {
  const d = cur();
  if (!d || d.sealed) return;
  const { start, end } = bodyCaret;
  let s = start !== end ? d.body.slice(start, end).trim() : sentenceAt(d.body, start);
  if (!s && d.body.trim()) s = sentenceAt(d.body, Math.max(0, d.body.trimEnd().length - 1));
  if (!s) { toast('본문에서 문장을 선택하거나 커서를 둔 뒤 눌러 주세요'); return; }
  d.highlightSentence = s.replace(/\s+/g, ' ');
  el.hl.value = d.highlightSentence;
  S.saveNow(d); onSaved();
  toast('⭐ 오늘의 대표 문장으로 지정했습니다');
}

// =====================================================================
// 어투 거울
// =====================================================================
function renderMirror() {
  const d = cur();
  const text = d ? d.body : '';
  el.radar.checked = S.state.settings.radarOn;
  if (!text.trim()) {
    el.stats.innerHTML = '';
    el.bars.innerHTML = '';
    el.mirror.innerHTML = '<span class="placeholder">본문을 쓰면 이곳에 어투 거울이 비칩니다. 하이라이트된 단어를 누르면 본문의 해당 위치로 이동합니다.</span>';
    return;
  }
  if (!S.state.settings.radarOn) {
    el.stats.innerHTML = '<span class="chip">레이더 꺼짐</span>';
    el.bars.innerHTML = '';
    el.mirror.innerHTML = escapeHTML(text);
    return;
  }
  const a = analyze(text, S.state.settings.habits);
  const st = a.stats;
  const habitTotal = Object.values(st.habitHits).reduce((x, y) => x + y, 0);
  const chips = [
    `<span class="chip score" title="고유 어절 ÷ 전체 어절">어휘 다양성 <b>${st.diversity}</b>점</span>`,
    `<span class="chip">어절 <b>${st.wordCount}</b></span>`,
    `<span class="chip">문장 <b>${st.sentenceCount}</b></span>`,
    st.firstPersonCount ? `<span class="chip ${st.firstPersonCount >= 3 ? 'warn' : ''}">1인칭 <b>${st.firstPersonCount}</b></span>` : '',
    st.longCount ? `<span class="chip warn">만연체 <b>${st.longCount}</b></span>` : '',
    st.repRuns.length ? `<span class="chip warn">연속 어미 <b>${st.repRuns.length}</b>구간</span>` : '',
    habitTotal ? `<span class="chip warn">습관어 <b>${habitTotal}</b></span>` : '',
  ];
  if (st.repeatedRoots.length) {
    chips.push(`<div class="roots-line">반복 어근: ${st.repeatedRoots.slice(0, 6).map((r) => `<b>${escapeHTML(r.root)}</b>×${r.count}`).join(' · ')}</div>`);
  }
  el.stats.innerHTML = chips.join('');
  el.bars.innerHTML = st.endings.length
    ? `<div class="eb-title">문장 종결어미 분포 (상위 3)</div>` + st.endings.map((e) => `
      <div class="eb-row"><span>${escapeHTML(e.label)}</span>
        <span class="eb-track"><span class="eb-fill" style="width:${Math.round(e.ratio * 100)}%"></span></span>
        <span class="eb-pct">${Math.round(e.ratio * 100)}%</span></div>`).join('')
    : '';
  el.mirror.innerHTML = toHTML(text, a);
}

// ---------- 습관어 대체어 팝오버 ----------
function showHabitPopover(span) {
  const d = cur();
  const h = S.state.settings.habits[Number(span.dataset.h)];
  if (!d || !h) return;
  const hs = Number(span.dataset.hs), he = Number(span.dataset.he);
  if (d.body.slice(hs, he) !== h.word) return;
  const alts = h.alternatives.length ? h.alternatives : [''];
  el.popover.innerHTML = `<div class="pop-title">“${escapeHTML(h.word)}” 대신${d.sealed ? ' (봉인됨)' : ''}</div>` +
    alts.map((alt, i) => `<button data-alt="${i}" class="${alt ? '' : 'del'}" ${d.sealed ? 'disabled' : ''}>${alt ? escapeHTML(alt) : '(삭제)'}</button>`).join('');
  el.popover.dataset.hs = hs;
  el.popover.dataset.he = he;
  el.popover.dataset.h = span.dataset.h;
  el.popover.hidden = false;
  const r = span.getBoundingClientRect();
  const pw = el.popover.offsetWidth, ph = el.popover.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
  let top = r.bottom + 6;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  el.popover.style.left = left + 'px';
  el.popover.style.top = top + 'px';
}
function closePopover() { el.popover.hidden = true; }
function applyAlternative(i) {
  const d = cur();
  const h = S.state.settings.habits[Number(el.popover.dataset.h)];
  if (!d || !h || d.sealed) return;
  const hs = Number(el.popover.dataset.hs);
  let he = Number(el.popover.dataset.he);
  if (d.body.slice(hs, he) !== h.word) { closePopover(); return; }
  const alt = h.alternatives[i] ?? '';
  const ta = FIELDS.body;
  if (!alt && ta.value[he] === ' ') he++; // 삭제 시 뒤 공백도 정리
  ta.setRangeText(alt, hs, he, 'end');
  onFieldInput('body');
  closePopover();
  clearTimeout(mirrorTimer);
  renderMirror();
  selectInField('body', hs, hs + alt.length);
  toast(alt ? `“${h.word}” → “${alt}”` : `“${h.word}” 삭제`);
}

// =====================================================================
// 일기 조작
// =====================================================================
function ensureToday() {
  const today = S.todayStr();
  const found = sortDiaries(S.liveDiaries().filter((d) => d.date === today))[0];
  if (found) { openDiary(found.id); return found; }
  return newDiary(today);
}
function newDiary(date = S.todayStr()) {
  const { diary, carried, from } = S.createDiary(date);
  openDiary(diary.id);
  renderStreak();
  if (carried) toast(`⤵ ${from} 미완료 복선 ${carried}개를 이월했습니다`, 3000);
  return diary;
}
function togglePin() {
  const d = cur();
  if (!d) return;
  d.pinned = !d.pinned;
  S.saveNow(d);
  renderMeta(); renderList();
  toast(d.pinned ? '📌 상단에 고정했습니다' : '핀 고정을 해제했습니다', 1400);
}
function toggleSeal() {
  const d = cur();
  if (!d) return;
  if (!d.sealed) {
    if (!confirm('이 일기를 채증 원본으로 봉인할까요?\n봉인 후에는 읽기 전용이 되며 봉인 시각이 기록됩니다.')) return;
    S.flushSave(d.id);
    d.sealed = true;
    d.sealedAt = new Date().toLocaleString('ko-KR', { hour12: false });
  } else {
    if (!confirm(`봉인을 해제할까요?\n(봉인 시각: ${d.sealedAt})\n해제하면 다시 수정할 수 있으며 봉인 기록은 지워집니다.`)) return;
    d.sealed = false;
    d.sealedAt = '';
  }
  S.saveNow(d);
  renderMeta(); renderFsLines(); renderList();
  toast(d.sealed ? '🔒 봉인했습니다' : '봉인을 해제했습니다');
}
function reportText(d) {
  const block = (label, text) => `■ ${label}\n${text.trim() || '(없음)'}`;
  return [
    `[${d.date} (${weekdayOf(d.date)}) 일기]`,
    d.highlightSentence.trim() ? `⭐ ${d.highlightSentence.trim()}` : '',
    block('복선', d.foreshadow),
    block('본문', d.body),
    block('주석', d.footnote),
    d.sealed ? `🔒 봉인: ${d.sealedAt}` : '',
  ].filter(Boolean).join('\n\n');
}
async function copyReport() {
  const d = cur();
  if (!d) return;
  const text = reportText(d);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  toast('📋 보고서 형식으로 복사했습니다');
}
function doUndo() {
  const d = cur();
  if (!d) return;
  if (S.undo(d.id)) {
    fillEditor(); renderList();
    el.status.textContent = `되돌림 ${hhmm()}`;
    toast('↶ 직전 상태로 되돌렸습니다 (다시 누르면 취소)');
  }
}
function deleteCurrent() {
  const d = cur();
  if (!d || d.sealed) return;
  if (!confirm(`${d.date} 일기를 삭제할까요?\n삭제 후에는 되돌릴 수 없습니다. (백업 JSON으로만 복구 가능)`)) return;
  S.deleteDiary(d.id);
  currentId = null;
  const next = sortDiaries(S.liveDiaries())[0];
  if (next) openDiary(next.id); else ensureToday();
  renderStreak();
  toast('삭제했습니다');
}
function changeDate(v) {
  const d = cur();
  if (!d || d.sealed || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  d.date = v;
  el.weekday.textContent = weekdayOf(v) + '요일';
  S.saveNow(d);
  onSaved();
}

// =====================================================================
// 모바일 3초 복선 + 음성 입력 (STT)
// =====================================================================
function quickAdd(text) {
  text = (text || '').trim();
  if (!text) return;
  const today = S.todayStr();
  let d = sortDiaries(S.liveDiaries().filter((x) => x.date === today))[0];
  if (!d) d = newDiary(today);
  if (d.sealed) { toast('오늘 일기가 봉인되어 있어 추가할 수 없습니다'); return; }
  S.flushSave(d.id);
  const line = `- [${hhmm()}] ${text}`;
  d.foreshadow = d.foreshadow.trim() ? d.foreshadow.replace(/\s+$/, '') + '\n' + line : line;
  S.saveNow(d);
  if (currentId !== d.id) openDiary(d.id);
  else { FIELDS.foreshadow.value = d.foreshadow; autoGrow(FIELDS.foreshadow); renderFsLines(); onSaved(); }
  ZONE_EL.foreshadow.open = true;
  toast('⚡ 복선에 던졌습니다', 1400);
}

let recog = null;
let listening = false;
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('이 브라우저는 음성 인식을 지원하지 않습니다 (안드로이드 크롬 권장)'); return; }
  if (listening && recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = 'ko-KR';
  recog.interimResults = true;
  recog.continuous = false;
  recog.maxAlternatives = 1;
  const before = el.quickInput.value;
  recog.onstart = () => { listening = true; el.mic.classList.add('listening'); el.quickInput.placeholder = '🎙 듣고 있어요…'; };
  recog.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    el.quickInput.value = (before ? before + ' ' : '') + (final || interim);
    if (final) { quickAdd(el.quickInput.value); el.quickInput.value = ''; }
  };
  recog.onerror = (e) => { toast(e.error === 'not-allowed' ? '마이크 권한이 필요합니다' : '음성 인식 오류: ' + e.error); };
  recog.onend = () => { listening = false; el.mic.classList.remove('listening'); el.quickInput.placeholder = '⚡ 3초 복선 던지기'; };
  try { recog.start(); } catch (err) { toast('음성 인식을 시작할 수 없습니다'); }
}

// =====================================================================
// 통합 검색
// =====================================================================
const searchState = { q: '', period: 'all', zone: 'all', tag: '', tab: 'results' };
function openSearch() {
  openModal('searchModal');
  renderTagChips();
  renderSearch();
  setTimeout(() => $('#searchInput').focus(), 30);
}
function renderTagChips() {
  const tags = Q.allTags(S.liveDiaries()).slice(0, 30);
  $('#tagChips').innerHTML = tags.map((t) =>
    `<button data-tag="${escapeHTML(t.tag)}" class="${t.tag === searchState.tag ? 'on' : ''}">#${escapeHTML(t.tag)} <small>${t.count}</small></button>`).join('');
}
function renderSearch() {
  const box = $('#searchResults');
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === searchState.tab));
  if (searchState.tab === 'highlights') {
    const list = Q.highlightList(S.liveDiaries());
    box.innerHTML = list.length
      ? list.map((h) => `<button class="result" data-id="${h.id}" data-hl="1">
          <div class="r-meta"><span>${h.date} (${weekdayOf(h.date)})</span>${h.pinned ? '<span>📌</span>' : ''}</div>
          <div class="r-snip">⭐ ${escapeHTML(h.text)}</div></button>`).join('')
      : '<div class="hint">아직 지정한 대표 문장이 없습니다.</div>';
    return;
  }
  const res = Q.search(S.liveDiaries(), searchState);
  if (!searchState.q.trim() && !searchState.tag) {
    box.innerHTML = '<div class="hint">검색어를 입력하거나 #태그를 선택하세요. 기간 · 구역 · 태그를 함께 조합할 수 있습니다.</div>';
    return;
  }
  box.innerHTML = res.length
    ? res.map((r) => `<button class="result" data-id="${r.id}" data-zone="${r.zone}" data-index="${r.index}" data-len="${r.length}">
        <div class="r-meta"><span>${r.date} (${weekdayOf(r.date)})</span><span class="r-zone">${r.zoneLabel}</span>${r.more ? `<span>외 ${r.more}건</span>` : ''}</div>
        <div class="r-snip">${r.html}</div></button>`).join('')
    : '<div class="hint">조건에 맞는 기록이 없습니다.</div>';
}
function jumpToResult(btn) {
  closeModal('searchModal');
  openDiary(btn.dataset.id);
  if (btn.dataset.hl) return;
  const zone = btn.dataset.zone, idx = Number(btn.dataset.index), len = Number(btn.dataset.len);
  requestAnimationFrame(() => selectInField(zone, idx, idx + len));
}

// =====================================================================
// 미니 달력
// =====================================================================
let calMonth = new Date();
function openCalendar() {
  const d = cur();
  if (d) { const [y, m] = d.date.split('-').map(Number); calMonth = new Date(y, m - 1, 1); }
  else calMonth = new Date();
  renderCalendar();
  openModal('calendarModal');
}
function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#calTitle').textContent = `${y}년 ${m + 1}월`;
  const idx = Q.dateIndex(S.liveDiaries());
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = S.todayStr();
  const curDate = cur() ? cur().date : '';
  let html = '';
  for (let i = 0; i < first; i++) html += '<span></span>';
  for (let day = 1; day <= days; day++) {
    const ds = `${y}-${pad(m + 1)}-${pad(day)}`;
    const has = idx.has(ds);
    const cls = [has ? 'has' : '', ds === today ? 'today' : '', ds === curDate ? 'cur' : ''].join(' ');
    html += `<button data-date="${ds}" class="${cls}" title="${has ? idx.get(ds).length + '개 기록' : ''}">${day}</button>`;
  }
  $('#calGrid').innerHTML = html;
}
function jumpToDate(ds) {
  const found = sortDiaries(S.liveDiaries().filter((d) => d.date === ds))[0];
  closeModal('calendarModal');
  if (found) { openDiary(found.id); return; }
  if (confirm(`${ds}에는 일기가 없습니다. 새로 만들까요?`)) newDiary(ds);
}

// =====================================================================
// 설정 · 클라우드 · 백업
// =====================================================================
function habitsToText(habits) {
  return habits.map((h) => `${h.word} = ${h.alternatives.map((a) => a || '(삭제)').join(', ')}`).join('\n');
}
function textToHabits(text) {
  return text.split('\n').map((line) => {
    const [w, rest = ''] = line.split('=');
    const word = (w || '').trim();
    if (!word) return null;
    const alts = rest.split(',').map((s) => s.trim()).filter((s) => s.length).map((s) => (s === '(삭제)' ? '' : s));
    return { word, alternatives: alts.length ? alts : [''] };
  }).filter(Boolean);
}
async function renderAppInfo() {
  $('#appVersion').textContent = APP_VERSION;
  const p = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  $('#persistStatus').textContent = p === true ? '🛡 영구 저장 보호 중' : p === false ? '저장 보호 대기 (앱 설치 시 자동 보호)' : '';
}
function openSettings() {
  renderAppInfo();
  $('#habitsText').value = habitsToText(S.state.settings.habits);
  const cfg = S.cloudConfig();
  $('#cloudUrl').value = cfg && cfg.source === 'settings' ? cfg.url : '';
  $('#cloudKey').value = cfg && cfg.source === 'settings' ? cfg.key : '';
  renderCloudStatus();
  openModal('settingsModal');
}
function renderCloudStatus() {
  const cfg = S.cloudConfig();
  const u = S.currentUser();
  let msg;
  if (!cfg) msg = '로컬 모드 — 이 기기 브라우저(localStorage)에만 저장됩니다.';
  else if (!S.isCloudReady()) msg = '클라우드 설정됨 · 연결 실패(오프라인?) → 로컬로 저장 중';
  else if (u) msg = `☁ ${u.email} 계정으로 동기화 중 (${cfg.source === 'code' ? 'storage.js 키' : '설정 키'})`;
  else msg = '클라우드 설정됨 · 로그인 필요';
  $('#cloudStatus').textContent = msg;
  $('#btnLogout').hidden = !u;
  $('#btnClearCloud').hidden = !(cfg && cfg.source === 'settings');
}
function renderSync(status = S.getSyncStatus()) {
  const label = { local: '로컬 저장', synced: '클라우드 동기화됨', syncing: '동기화 중…', error: '동기화 오류 (로컬에는 저장됨)', offline: '오프라인 (로컬에 저장 중)' }[status] || status;
  el.sync.className = 'sync-badge ' + status;
  el.sync.title = label + ' — 눌러서 동기화 설정';
  $('#syncLabel').textContent = { local: '로컬', synced: '동기화됨', syncing: '동기화 중', error: '동기화 오류', offline: '오프라인' }[status] || status;
}
function exportBackup() {
  const blob = new Blob([S.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `어투의서재-백업-${S.todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('💾 백업 파일을 내보냈습니다');
}
async function importBackup(file) {
  if (!file) return;
  try {
    const { added, updated } = S.importJSON(await file.text());
    toast(`복구 완료 — 추가 ${added} · 갱신 ${updated}`);
    applyTheme(); renderList(); renderStreak();
    if (!cur()) ensureToday(); else fillEditor();
  } catch (e) {
    toast('JSON 파일을 읽을 수 없습니다');
  }
}

// ---------- 로그인 잠금 ----------
function showLock(on) {
  $('#lockScreen').hidden = !on;
  if (on) { $('#lockMsg').textContent = ''; setTimeout(() => $('#lockEmail').focus(), 50); }
}
async function lockSubmit(mode) {
  const email = $('#lockEmail').value.trim(), pw = $('#lockPw').value;
  if (!email || !pw) { $('#lockMsg').textContent = '이메일과 비밀번호를 입력하세요.'; return; }
  $('#lockMsg').textContent = mode === 'up' ? '가입 중…' : '로그인 중…';
  const res = mode === 'up' ? await S.signUp(email, pw) : await S.signIn(email, pw);
  if (res.error) { $('#lockMsg').textContent = res.error; return; }
  if (res.needConfirm) { $('#lockMsg').textContent = '확인 메일을 보냈습니다. 메일 인증 후 로그인하세요.'; return; }
  $('#lockPw').value = '';
}

// =====================================================================
// 이벤트 바인딩
// =====================================================================
function bind() {
  // 에디터 입력
  for (const [zone, ta] of Object.entries(FIELDS)) {
    ta.addEventListener('input', (e) => {
      onFieldInput(zone);
      if (!e.isComposing) handleSlash(ta);
    });
    ta.addEventListener('compositionend', () => { setTimeout(() => handleSlash(ta), 0); });
  }
  const trackCaret = () => { const ta = FIELDS.body; bodyCaret = { start: ta.selectionStart, end: ta.selectionEnd }; };
  ['keyup', 'mouseup', 'select', 'blur', 'touchend'].forEach((ev) => FIELDS.body.addEventListener(ev, trackCaret));
  document.addEventListener('selectionchange', () => { if (document.activeElement === FIELDS.body) trackCaret(); });

  el.hl.addEventListener('input', () => {
    const d = cur();
    if (!d || d.sealed) return;
    d.highlightSentence = el.hl.value;
    touch(d);
  });
  $('#btnPickHighlight').addEventListener('mousedown', (e) => e.preventDefault()); // 본문 선택 유지
  $('#btnPickHighlight').addEventListener('click', pickHighlight);
  el.date.addEventListener('change', () => changeDate(el.date.value));

  el.pin.addEventListener('click', togglePin);
  el.seal.addEventListener('click', toggleSeal);
  el.copy.addEventListener('click', copyReport);
  el.undo.addEventListener('click', doUndo);
  el.del.addEventListener('click', deleteCurrent);

  el.fsLines.addEventListener('mousedown', (e) => { if (e.target.closest('.pull')) e.preventDefault(); });
  el.fsLines.addEventListener('click', (e) => {
    const pull = e.target.closest('.pull');
    if (pull) { pullToBody(Number(pull.dataset.i)); return; }
    const cb = e.target.closest('input[type="checkbox"]');
    if (cb) toggleCheck(Number(cb.dataset.i));
  });

  // 어투 거울 클릭 → 본문 역추적
  el.mirror.addEventListener('click', (e) => {
    const span = e.target.closest('span[data-s]');
    if (!span) return;
    const d = cur();
    if (!d) return;
    if (span.dataset.h !== undefined) {
      selectInField('body', Number(span.dataset.hs), Number(span.dataset.he));
      showHabitPopover(span);
    } else {
      closePopover();
      selectInField('body', Number(span.dataset.s), Number(span.dataset.e));
    }
  });
  el.popover.addEventListener('mousedown', (e) => e.preventDefault());
  el.popover.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-alt]');
    if (b) applyAlternative(Number(b.dataset.alt));
  });
  document.addEventListener('mousedown', (e) => {
    if (!el.popover.hidden && !el.popover.contains(e.target) && !e.target.closest('.mirror span[data-h]')) closePopover();
  });
  el.radar.addEventListener('change', () => {
    S.state.settings.radarOn = el.radar.checked;
    S.saveSettings();
    renderMirror();
  });

  // 목록
  el.list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) openDiary(li.dataset.id);
  });
  $('#btnNew').addEventListener('click', () => {
    const today = S.todayStr();
    const exists = S.liveDiaries().some((d) => d.date === today);
    if (exists && !confirm('오늘 일기가 이미 있습니다. 하나 더 만들까요?')) { ensureToday(); return; }
    newDiary(today);
  });
  $('#btnToday').addEventListener('click', ensureToday);
  $('#btnMenu').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('side-open'));

  // 상단바
  $('#btnSearch').addEventListener('click', openSearch);
  $('#btnCalendar').addEventListener('click', openCalendar);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnBlur').addEventListener('click', () => toggleBlur());
  $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
  $('#btnThemeCycle').addEventListener('click', () => {
    const t = THEMES[(THEMES.indexOf(S.state.settings.theme) + 1) % THEMES.length];
    setTheme(t);
    toast({ paper: '종이', sepia: '세피아', dark: '심야 다크' }[t] + ' 테마', 1000);
  });

  // 모달 공통
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; });
  });

  // 검색
  $('#searchInput').addEventListener('input', (e) => { searchState.q = e.target.value; searchState.tab = 'results'; renderSearch(); });
  $('#periodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    searchState.period = b.dataset.period;
    $$('#periodSeg button').forEach((x) => x.classList.toggle('on', x === b));
    renderSearch();
  });
  $('#zoneSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    searchState.zone = b.dataset.zone;
    $$('#zoneSeg button').forEach((x) => x.classList.toggle('on', x === b));
    renderSearch();
  });
  $('#tagChips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    searchState.tag = searchState.tag === b.dataset.tag ? '' : b.dataset.tag;
    searchState.tab = 'results';
    renderTagChips(); renderSearch();
  });
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { searchState.tab = b.dataset.tab; renderSearch(); }));
  $('#searchResults').addEventListener('click', (e) => { const b = e.target.closest('.result'); if (b) jumpToResult(b); });

  // 달력
  $('#calPrev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
  $('#calNext').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
  $('#calGrid').addEventListener('click', (e) => { const b = e.target.closest('button[data-date]'); if (b) jumpToDate(b.dataset.date); });

  // 설정
  $('#btnSaveHabits').addEventListener('click', () => {
    S.state.settings.habits = textToHabits($('#habitsText').value);
    S.saveSettings();
    $('#habitsText').value = habitsToText(S.state.settings.habits);
    renderMirror();
    toast(`습관어 ${S.state.settings.habits.length}개 저장`);
  });
  $('#btnSaveCloud').addEventListener('click', () => {
    const url = $('#cloudUrl').value.trim(), key = $('#cloudKey').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) { toast('Project URL과 anon key를 확인하세요'); return; }
    S.flushAll();
    S.setCloudConfig(url, key);
    location.reload();
  });
  $('#btnClearCloud').addEventListener('click', () => {
    if (!confirm('클라우드 연결을 해제할까요? 이 기기의 로컬 데이터는 유지됩니다.')) return;
    S.flushAll(); S.setCloudConfig(null); location.reload();
  });
  $('#btnLogout').addEventListener('click', async () => { S.flushAll(); await S.signOut(); closeModal('settingsModal'); });
  $('#btnExport').addEventListener('click', exportBackup);
  $('#btnDeleteSamples').addEventListener('click', () => {
    if (!S.liveDiaries().some((d) => d.id.startsWith(SAMPLE_PREFIX))) { toast('남아 있는 샘플 일기가 없습니다'); return; }
    if (!confirm('샘플 일기 3개를 삭제할까요? 직접 쓴 일기는 지워지지 않습니다.')) return;
    const n = S.deleteSamples(SAMPLE_PREFIX);
    if (!cur()) ensureToday(); else fillEditor();
    renderList(); renderStreak();
    toast(`샘플 일기 ${n}개를 삭제했습니다`);
  });
  $('#syncBadge').addEventListener('click', openSettings);

  // 모바일 키보드: 본문 입력 중엔 3초 복선 바 숨김 + 키보드 높이만큼 바를 위로
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t !== el.quickInput && t.matches('textarea, input:not([type="checkbox"]):not([type="file"])')) document.body.classList.add('typing');
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches('textarea, input') || a === el.quickInput) document.body.classList.remove('typing');
  }, 0));
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onVV = () => {
      const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', kb + 'px');
    };
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
  }
  $('#importFile').addEventListener('change', (e) => { importBackup(e.target.files[0]); e.target.value = ''; });

  // 잠금 화면
  $('#lockForm').addEventListener('submit', (e) => { e.preventDefault(); lockSubmit('in'); });
  $('#lockSignup').addEventListener('click', () => lockSubmit('up'));
  $('#lockLocal').addEventListener('click', () => {
    if (!confirm('클라우드 연결을 해제하고 이 기기에서 로컬 모드로 사용할까요?')) return;
    S.setCloudConfig(null); location.reload();
  });

  // 모바일 3초 복선
  el.quickBar.addEventListener('submit', (e) => { e.preventDefault(); quickAdd(el.quickInput.value); el.quickInput.value = ''; });
  el.mic.addEventListener('click', toggleMic);

  // 키보드: Esc 2회 블러, Ctrl+K 검색, Ctrl+S 즉시 저장
  let lastEsc = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // 1) 열린 창이 있으면 Esc는 '닫기'로만 쓰고 블러 연타 카운트에서 제외
      //    → 검색창을 닫으려고 Esc를 두 번 눌러도 블러가 걸리지 않음
      if (!document.body.classList.contains('blurred')) {
        if (!el.popover.hidden) { closePopover(); lastEsc = 0; return; }
        if (anyModalOpen()) { closeAllModals(); lastEsc = 0; return; }
        if (document.body.classList.contains('side-open')) { document.body.classList.remove('side-open'); lastEsc = 0; return; }
      }
      // 2) 아무 창도 없을 때만 450ms 안에 2회 → 블러 토글
      const now = Date.now();
      if (now - lastEsc < 450) { lastEsc = 0; toggleBlur(); return; }
      lastEsc = now;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const d = cur();
      if (d && S.flushSave(d.id)) toast('저장했습니다', 1000);
    }
  });

  window.addEventListener('resize', () => Object.values(FIELDS).forEach(autoGrow));
  window.addEventListener('pagehide', S.flushAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) S.flushAll(); });
}

// =====================================================================
// 저장소 이벤트 (원격 동기화 반영)
// =====================================================================
S.onChange((type) => {
  if (type === 'sync') { renderSync(); return; }
  if (type === 'remote-settings') { applyTheme(); renderMirror(); return; }
  if (type === 'auth') {
    const u = S.currentUser();
    renderCloudStatus();
    if (u) { showLock(false); toast(`☁ ${u.email} 로그인`); if (ready) ensureToday(); }
    else if (S.isCloudReady()) showLock(true);
    return;
  }
  if (type === 'remote') {
    renderList(); renderStreak();
    const d = cur();
    if (!d) { if (ready) ensureToday(); return; }
    const editing = Object.values(FIELDS).includes(document.activeElement) || document.activeElement === el.hl;
    if (!S.hasPending(d.id) && !editing) fillEditor();
    else renderMeta();
  }
});

// =====================================================================
// 시작
// =====================================================================
async function init() {
  S.load();
  const seeded = S.seedSamplesIfFirstRun(buildSamples);
  if (seeded) setTimeout(() => toast(`📖 샘플 일기 ${seeded}개를 넣었습니다 — ⚙ 설정에서 한 번에 지울 수 있어요`, 4200), 600);
  applyTheme();
  bind();
  renderSync();
  renderList();
  renderStreak();
  // 우선 로컬 데이터로 즉시 화면 표시
  const today = S.liveDiaries().find((d) => d.date === S.todayStr());
  const first = today || sortDiaries(S.liveDiaries())[0];
  if (first) openDiary(first.id); else renderMirror();

  const res = await S.initCloud();
  ready = true;
  if (res.mode === 'cloud' && !res.user) { showLock(true); return; }
  if (res.error) toast('클라우드 연결 실패 — 로컬 모드로 저장합니다', 2800);
  ensureToday();
}

// ---------- PWA: 설치 버튼 · 업데이트 ----------
let installEvt = null;
const installBtns = () => [$('#btnInstall'), $('#btnInstall2')];
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  installBtns().forEach((b) => { b.hidden = false; });
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  installBtns().forEach((b) => { b.hidden = true; });
  S.requestPersist();
  toast('📲 홈 화면에 설치했습니다');
});
installBtns().forEach((b) => b.addEventListener('click', async () => {
  if (!installEvt) { toast('크롬 메뉴 ⋮ → "홈 화면에 추가"로 설치할 수 있습니다', 3000); return; }
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  installBtns().forEach((x) => { x.hidden = true; });
}));

let swReg = null;
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast(`✨ 새 버전(${APP_VERSION})이 적용되었습니다 — 일기는 그대로입니다`, 3200);
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js')
    .then((r) => { swReg = r; })
    .catch((e) => console.warn('SW 등록 실패', e)));
}
$('#btnCheckUpdate').addEventListener('click', async () => {
  S.flushAll();
  if (!swReg) { location.reload(); return; }
  try { await swReg.update(); } catch { /* 오프라인 */ }
  toast('최신 버전을 확인했습니다 — 새로고침합니다', 1200);
  setTimeout(() => location.reload(), 1200);
});

S.onChange((type) => { if (type === 'restored') setTimeout(() => toast('🛟 자동 백업에서 일기를 복구했습니다', 3500), 300); });
S.requestPersist();

init();
