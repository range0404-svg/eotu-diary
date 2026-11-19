// search.js — 통합 검색(문맥 스니펫 · 기간/구역/태그 교차 필터) · 해시태그 · 달력 인덱스 · 대표 문장 모음
import { escapeHTML } from './analyzer.js';
import { todayStr, addDays } from './storage.js';

export const ZONES = { foreshadow: '복선', body: '본문', footnote: '주석' };
const ZONE_KEYS = Object.keys(ZONES);
const TAG_RE = /#([\p{L}\p{N}_]+)/gu;
const CTX_LINES = 2;
const MAX_LINE = 140;
const MAX_HITS_PER_ZONE = 3;

export function extractTags(text) {
  const out = new Set();
  for (const m of String(text).matchAll(TAG_RE)) out.add(m[1]);
  return out;
}
export function diaryTags(d, zones = ZONE_KEYS) {
  const set = new Set();
  zones.forEach((z) => extractTags(d[z] || '').forEach((t) => set.add(t)));
  return set;
}
/** 전체 태그와 사용 횟수 (많은 순) */
export function allTags(diaries) {
  const counts = new Map();
  for (const d of diaries) diaryTags(d).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

function periodCutoff(period) {
  if (period === '7') return addDays(todayStr(), -6);
  if (period === '30') return addDays(todayStr(), -29);
  return null;
}

/** 원문 내 needle 위치를 모두 찾음 (대소문자 무시) */
function findAll(hay, needle) {
  const out = [];
  if (!needle) return out;
  const h = hay.toLowerCase(), n = needle.toLowerCase();
  let i = h.indexOf(n);
  while (i >= 0) { out.push(i); i = h.indexOf(n, i + n.length); }
  return out;
}

function clipLine(line, focus = -1, len = 0) {
  if (line.length <= MAX_LINE) return { text: line, offset: 0 };
  if (focus < 0) return { text: line.slice(0, MAX_LINE) + '…', offset: 0 };
  const start = Math.max(0, focus - 50);
  const end = Math.min(line.length, focus + len + 70);
  return { text: (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : ''), offset: start - (start > 0 ? 1 : 0) };
}

function markText(text, needle) {
  if (!needle) return escapeHTML(text);
  const pos = findAll(text, needle);
  let out = '', p = 0;
  for (const i of pos) {
    out += escapeHTML(text.slice(p, i)) + '<mark>' + escapeHTML(text.slice(i, i + needle.length)) + '</mark>';
    p = i + needle.length;
  }
  return out + escapeHTML(text.slice(p));
}

/** 검색어 앞뒤 2줄 문맥 스니펫 */
export function snippet(text, index, len, needle) {
  const lines = text.split('\n');
  let acc = 0, li = 0;
  for (; li < lines.length; li++) {
    if (index <= acc + lines[li].length) break;
    acc += lines[li].length + 1;
  }
  li = Math.min(li, lines.length - 1);
  const from = Math.max(0, li - CTX_LINES), to = Math.min(lines.length - 1, li + CTX_LINES);
  const parts = [];
  for (let k = from; k <= to; k++) {
    if (k === li) {
      const { text: t } = clipLine(lines[k], index - acc, len);
      parts.push(`<span class="hit">${markText(t, needle)}</span>`);
    } else if (lines[k].trim()) {
      parts.push(`<span class="ctx">${markText(clipLine(lines[k]).text, needle)}</span>`);
    }
  }
  return parts.join('\n');
}

/**
 * @param {object[]} diaries
 * @param {{q?:string, period?:'all'|'7'|'30', zone?:'all'|'foreshadow'|'body'|'footnote', tag?:string}} opt
 */
export function search(diaries, { q = '', period = 'all', zone = 'all', tag = '' } = {}) {
  q = q.trim();
  // 검색창에 "#태그"만 입력한 경우 태그 필터로 해석
  if (!tag && /^#[\p{L}\p{N}_]+$/u.test(q)) { tag = q.slice(1); q = ''; }
  if (!q && !tag) return [];
  const cutoff = periodCutoff(period);
  const zones = zone === 'all' ? ZONE_KEYS : [zone];
  const sorted = [...diaries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  const results = [];
  for (const d of sorted) {
    if (cutoff && d.date < cutoff) continue;
    if (tag && !diaryTags(d, zones).has(tag)) continue;
    for (const z of zones) {
      const text = d[z] || '';
      if (!text) continue;
      const needle = q || ('#' + tag);
      let hits = findAll(text, needle);
      if (!q && tag) hits = hits.filter((i) => !/[\p{L}\p{N}_]/u.test(text[i + needle.length] || ''));
      hits.slice(0, MAX_HITS_PER_ZONE).forEach((idx) => {
        results.push({
          id: d.id, date: d.date, zone: z, zoneLabel: ZONES[z],
          index: idx, length: needle.length,
          html: snippet(text, idx, needle.length, needle),
          more: hits.length > MAX_HITS_PER_ZONE ? hits.length - MAX_HITS_PER_ZONE : 0,
        });
      });
    }
  }
  return results;
}

/** 대표 문장 모음 */
export function highlightList(diaries) {
  return diaries
    .filter((d) => d.highlightSentence && d.highlightSentence.trim())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({ id: d.id, date: d.date, text: d.highlightSentence.trim(), pinned: d.pinned }));
}

/** 미니 달력용 날짜 인덱스: date -> diary[] */
export function dateIndex(diaries) {
  const map = new Map();
  for (const d of diaries) {
    if (!map.has(d.date)) map.set(d.date, []);
    map.get(d.date).push(d);
  }
  return map;
}
