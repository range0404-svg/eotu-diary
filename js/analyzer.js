// analyzer.js — 2세대 어투 교정 엔진
// 어근 묶음 반복 · 1인칭 남발 · 3연속 동일 종결어미 · 60자 만연체 · 종결어미 분포 · 습관어 · 어휘 다양성

export const FIRST_PERSON = ['나는', '내가', '나를', '내', '제가', '저는'];
export const LONG_LIMIT = 60;
const ROOT_MIN = 3;
const FIRST_MIN = 3;
const REP_MIN = 3;

const LETTER = /[\p{L}\p{N}]/u;
const ROOT_OK = /^\p{L}{2}/u;
const HANGUL_END = /[가-힣]{2}$/;
const SENT_RE = /[^.!?。…\n]+[.!?。…]*/g;

/**
 * 종결어미 정규화: 뒤 2음절 기준이되, 과거형(받침 ㅆ + 다)은 어간과 무관하게 한 묶음으로.
 * 먹었다 · 탔다 · 갔다 → "았/었다", 했다 → "했다", 이다 → "이다", 합니다 → "니다"
 */
export function endingOf(core) {
  const last2 = core.slice(-2);
  if (last2 === '했다') return '했다';
  const code = core.charCodeAt(core.length - 2) - 0xac00;
  const jong = code >= 0 && code < 11172 ? code % 28 : -1;
  if (core.endsWith('다') && jong === 20) return '았/었다'; // 받침 ㅆ
  return last2;
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {string} text 본문
 * @param {{word:string, alternatives:string[]}[]} habits
 */
export function analyze(text, habits = []) {
  // 1) 어절 토큰화 (앞뒤 문장부호를 떼어낸 core 범위 보관)
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    let a = 0, b = raw.length;
    while (a < b && !LETTER.test(raw[a])) a++;
    while (b > a && !LETTER.test(raw[b - 1])) b--;
    tokens.push({
      raw, start: m.index, end: m.index + raw.length,
      core: raw.slice(a, b), cs: m.index + a, ce: m.index + b,
      cls: new Set(), habit: null, sent: -1, tips: [],
    });
  }

  // 2) 문장 분리 (마침표·느낌표·물음표·줄바꿈 기준)
  const sentences = [];
  SENT_RE.lastIndex = 0;
  while ((m = SENT_RE.exec(text))) {
    const seg = m[0];
    const trimmed = seg.trim();
    if (!trimmed || !LETTER.test(trimmed)) continue;
    const lead = seg.length - seg.trimStart().length;
    sentences.push({ start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed, tokens: [], ending: null, endTok: null });
  }
  let j = 0;
  for (const t of tokens) {
    while (j < sentences.length && sentences[j].end <= t.start) j++;
    if (j < sentences.length && sentences[j].start <= t.start) { t.sent = j; sentences[j].tokens.push(t); }
  }

  // 3) 만연체: 끊김 없이 60자 초과
  let longCount = 0;
  for (const s of sentences) {
    s.long = s.text.length > LONG_LIMIT;
    if (s.long) {
      longCount++;
      s.tokens.forEach((t) => { t.cls.add('s-long'); });
      if (s.tokens[0]) s.tokens[0].tips.push(`만연체 ${s.text.length}자 — 호흡을 끊어 보세요`);
    }
  }

  // 4) 종결어미 분포 + 3연속 동일 어미
  const endingCounts = new Map();
  const seq = [];
  for (const s of sentences) {
    const wt = [...s.tokens].reverse().find((t) => t.core);
    if (!wt || !HANGUL_END.test(wt.core)) { seq.push(null); continue; }
    const e = endingOf(wt.core);
    s.ending = e; s.endTok = wt;
    seq.push({ e, s });
    endingCounts.set(e, (endingCounts.get(e) || 0) + 1);
  }
  const repRuns = [];
  let run = [];
  const flushRun = () => {
    if (run.length >= REP_MIN) {
      repRuns.push({ ending: run[0].e, count: run.length });
      run.forEach((x) => { x.s.endTok.cls.add('w-rep'); x.s.endTok.tips.push(`"~${x.e}" ${run.length}문장 연속`); });
    }
    run = [];
  };
  for (const x of seq) {
    if (x && run.length && run[0].e === x.e) run.push(x);
    else { flushRun(); if (x) run = [x]; }
  }
  flushRun();
  const endTotal = [...endingCounts.values()].reduce((a, b) => a + b, 0);
  const endings = [...endingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([e, count]) => ({ label: '~' + e, count, ratio: endTotal ? count / endTotal : 0 }));

  // 5) 1인칭 주어 남발
  const fp = tokens.filter((t) => FIRST_PERSON.includes(t.core));
  if (fp.length >= FIRST_MIN) fp.forEach((t) => { t.cls.add('w-first'); t.tips.push(`1인칭 주어 ${fp.length}회`); });

  // 6) 앞 2글자 어근 묶음 반복 (1글자 단어 제외)
  const rootMap = new Map();
  for (const t of tokens) {
    if (t.core.length < 2 || FIRST_PERSON.includes(t.core) || !ROOT_OK.test(t.core)) continue;
    const r = t.core.slice(0, 2).toLowerCase();
    if (!rootMap.has(r)) rootMap.set(r, []);
    rootMap.get(r).push(t);
  }
  const repeatedRoots = [];
  for (const [root, arr] of rootMap) {
    if (arr.length >= ROOT_MIN) {
      repeatedRoots.push({ root, count: arr.length });
      arr.forEach((t) => { t.cls.add('w-root'); t.tips.push(`어근 "${root}" ${arr.length}회 반복`); });
    }
  }
  repeatedRoots.sort((a, b) => b.count - a.count);

  // 7) 습관어
  const habitHits = {};
  const hs = habits
    .map((h, index) => ({ ...h, index }))
    .filter((h) => h.word)
    .sort((a, b) => b.word.length - a.word.length);
  for (const t of tokens) {
    for (const h of hs) {
      if (t.core.startsWith(h.word)) {
        t.habit = { index: h.index, word: h.word, start: t.cs, end: t.cs + h.word.length };
        t.cls.add('w-habit');
        t.tips.push(`습관어 "${h.word}" — 클릭해 대체어 선택`);
        habitHits[h.word] = (habitHits[h.word] || 0) + 1;
        break;
      }
    }
  }

  // 8) 어휘 다양성
  const cores = tokens.map((t) => t.core.toLowerCase()).filter(Boolean);
  const uniqueCount = new Set(cores).size;
  const diversity = cores.length ? Math.round((uniqueCount / cores.length) * 100) : 0;

  return {
    tokens, sentences,
    stats: {
      wordCount: cores.length, uniqueCount, diversity,
      sentenceCount: sentences.length, longCount,
      firstPersonCount: fp.length, repeatedRoots, endings, repRuns, habitHits,
    },
  };
}

/** 어투 거울 HTML — 하이라이트 단어마다 본문 위치(data-s/e)를 심어 역추적 가능 */
export function toHTML(text, a) {
  let out = '';
  let pos = 0;
  for (const t of a.tokens) {
    out += escapeHTML(text.slice(pos, t.start));
    pos = t.end;
    if (!t.cls.size) { out += escapeHTML(t.raw); continue; }
    let s = t.cs, e = t.ce;
    if (t.cls.size === 1 && t.cls.has('s-long')) { const sen = a.sentences[t.sent]; s = sen.start; e = sen.end; }
    if (e <= s) { s = t.start; e = t.end; }
    let attrs = `class="${[...t.cls].join(' ')}" data-s="${s}" data-e="${e}"`;
    if (t.habit) attrs += ` data-h="${t.habit.index}" data-hs="${t.habit.start}" data-he="${t.habit.end}"`;
    if (t.tips.length) attrs += ` title="${escapeHTML(t.tips.join(' · '))}"`;
    out += `<span ${attrs}>${escapeHTML(t.raw)}</span>`;
  }
  out += escapeHTML(text.slice(pos));
  if (text.endsWith('\n')) out += ' ';
  return out;
}
