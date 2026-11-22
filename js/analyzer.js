// analyzer.js — 3세대 어투 교정 엔진
//
// 판별 우선순위 (토큰마다 이 순서대로):
//   1) 조사 제거 원형 추출        stem
//   2) 고유명사 판별               properNouns 목록 / 호칭·직급 접미 → 어근 반복·메아리에서 제외, 6회+ 는 properSpam
//   3) 이 글에서만 무시           diary.ignoredWords → 어근 반복·메아리·고유명사 도배에서 제외
//   4) 근접 메아리 (echo)          2회뿐이어도 인접 문장 또는 40자 이내 같은 2글자 어근
//   5) 흐린 어투 레이더 (vague)    추측·회피 / 이중 피동 / 번역투 정규식
// + 기존 규칙: 습관어 · 어근 3회+ 반복 · 1인칭 3회+ · 3연속 같은 어미 · 60자+ 만연체 · 어미 분포 · 어휘 다양성
//
// 렌더링은 '구간 분할' 방식: 모든 경고를 [start,end) 범위(mark)로 만든 뒤 경계마다 잘라
// 겹치는 경고를 한 <span>의 여러 class로 합칩니다 → 하이라이트가 중첩(nesting)되어 깨지지 않습니다.

export const FIRST_PERSON = ['나는', '내가', '나를', '내', '제가', '저는'];
export const LONG_LIMIT = 60;
const ROOT_MIN = 3;          // 어근 반복 기준
const FIRST_MIN = 3;         // 1인칭 남발 기준
const REP_MIN = 3;           // 연속 같은 어미 기준
const PROPER_SPAM_MIN = 6;   // 고유명사 도배 기준
const ECHO_DISTANCE = 40;    // 근접 메아리 거리(글자)

// 1) 흔한 조사 (긴 것부터 검사)
const PARTICLES = ['이랑', '으로', '에게', '한테', '은', '는', '이', '가', '을', '를', '의', '에', '도', '만', '로', '와', '과', '랑', '께'];
// 2) 호칭·직급 접미
const TITLES = ['팀장', '과장', '대리', '부장', '차장', '이사', '대표', '사장', '실장', '선생', '교수', '작가', '감독', '님', '씨'];

const LETTER = /[\p{L}\p{N}]/u;
const ROOT_OK = /^\p{L}{2}/u;
const HANGUL_END = /[가-힣]{2}$/;
const SENT_RE = /[^.!?。…\n]+[.!?。…]*/g;

// 5) 흐린 어투 · 이중 피동 · 번역투
// 받침 ㄴ·ㄹ로 끝나는 관형형(인/한/할/을/나올/좋은/본…) 또는 '는' + 것 같다
const jongOf = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 ? c % 28 : -1; };
const isAdnominal = (ch) => ch === '는' || jongOf(ch) === 4 || jongOf(ch) === 8; // ㄴ=4, ㄹ=8
const VAGUE_RULES = [
  { re: /([가-힣])\s*것\s*같(습니다|아요|다|아|은|고|네)/g, label: '추측·회피', test: (m) => isAdnominal(m[1]) },
  { re: /하는\s*편이(다|라|고|었)/g, label: '추측·회피' },
  { re: /라고\s*생각(한다|된다|해)/g, label: '추측·회피' },
  { re: /(되어|보여|쓰여|만들어|불려|잊혀)(지[다는고면며었]|진|졌)/g, label: '이중 피동' },
  { re: /에\s*있어서/g, label: '번역투' },
  { re: /에\s*관하여/g, label: '번역투' },
  { re: /에\s*대하여/g, label: '번역투' },
];

/** 경고 종류 → 필터 키 · CSS 클래스 · 클릭 우선순위(작을수록 우선) */
export const MARK_KINDS = {
  habit:  { filter: 'habit',       cls: 'w-habit',  prio: 1 },
  proper: { filter: 'properSpam',  cls: 'w-proper', prio: 2 },
  echo:   { filter: 'echo',        cls: 'w-echo',   prio: 3 },
  root:   { filter: 'root',        cls: 'w-root',   prio: 4 },
  vague:  { filter: 'vague',       cls: 'v-vague',  prio: 5 },
  first:  { filter: 'firstPerson', cls: 'w-first',  prio: 6 },
  rep:    { filter: 'endingLong',  cls: 'w-rep',    prio: 7 },
  long:   { filter: 'endingLong',  cls: 's-long',   prio: 8 },
};

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 1) 조사 제거 원형 (조사를 떼도 1글자 이상 남을 때만) */
export function stemOf(word) {
  for (const p of PARTICLES) {
    if (word.length > p.length && word.endsWith(p)) return word.slice(0, -p.length);
  }
  return word;
}

/**
 * 종결어미 정규화: 뒤 2음절 기준이되, 과거형(받침 ㅆ + 다)은 어간과 무관하게 한 묶음으로.
 * 먹었다 · 탔다 · 갔다 → "았/었다", 했다 → "했다"
 */
export function endingOf(core) {
  const last2 = core.slice(-2);
  if (last2 === '했다') return '했다';
  const code = core.charCodeAt(core.length - 2) - 0xac00;
  const jong = code >= 0 && code < 11172 ? code % 28 : -1;
  if (core.endsWith('다') && jong === 20) return '았/었다';
  return last2;
}

const isFirstPerson = (core) => FIRST_PERSON.includes(core);
const hasTitle = (stem) => TITLES.some((t) => stem.length > t.length && stem.endsWith(t));
/** 띄어 쓴 호칭·직급 단어 자체인지 (팀장 / 팀장님 / 씨 / 님) */
const isTitleWord = (stem) => TITLES.includes(stem) || (stem.endsWith('님') && TITLES.includes(stem.slice(0, -1)));

/**
 * @param {string} text 본문
 * @param {{habits?:{word:string,alternatives:string[]}[], properNouns?:string[], ignoredWords?:string[], filters?:Object<string,boolean>}} opt
 */
export function analyze(text, { habits = [], properNouns = [], ignoredWords = [], filters = {} } = {}) {
  const on = (k) => filters[k] !== false;
  const marks = [];
  const add = (kind, s, e, extra = {}) => { if (e > s) marks.push({ kind, s, e, ...MARK_KINDS[kind], ...extra }); };

  // ---- 토큰화 + 1) 원형 ----
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    let a = 0, b = raw.length;
    while (a < b && !LETTER.test(raw[a])) a++;
    while (b > a && !LETTER.test(raw[b - 1])) b--;
    const core = raw.slice(a, b);
    tokens.push({ raw, start: m.index, end: m.index + raw.length, core, cs: m.index + a, ce: m.index + b, stem: core ? stemOf(core) : '', sent: -1 });
  }

  // ---- 틀 글자 제외: #해시태그 · "■ 항목:" 이름표 · "[소제목]" 줄 (템플릿 문구가 반복으로 잡히지 않게) ----
  const metaRanges = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    if (/^\s*\[[^\]]*\]\s*$/.test(line)) metaRanges.push([lineStart, lineStart + line.length]);
    else {
      const lm = line.match(/^\s*■[^:\n]*:/);
      if (lm) metaRanges.push([lineStart, lineStart + lm[0].length]);
    }
    lineStart += line.length + 1;
  }
  for (const hm of text.matchAll(/#[\p{L}\p{N}_]+/gu)) metaRanges.push([hm.index, hm.index + hm[0].length]);
  const inMeta = (s, e) => metaRanges.some(([a, b]) => s >= a && e <= b);

  // ---- 2) 고유명사 · 3) 무시 단어 판별 ----
  const pnList = properNouns.filter(Boolean);
  const ignored = new Set(ignoredWords.filter(Boolean));
  for (const t of tokens) {
    t.meta = !!t.core && inMeta(t.cs, t.ce);
    if (t.meta) { t.core = ''; t.stem = ''; } // 틀 글자는 어떤 규칙에도 잡히지 않음
  }
  // 띄어 쓴 호칭 앞 단어도 고유명사: "김철수 팀장님", "민지 씨" → 그 원형은 글 전체에서 고유명사
  const titledStems = new Set();
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    if (t.core && next && next.stem && isTitleWord(next.stem) && t.sent === next.sent && !isTitleWord(t.stem)) titledStems.add(t.stem);
  });
  for (const t of tokens) {
    if (!t.core) continue;
    t.root = ROOT_OK.test(t.core) ? t.core.slice(0, 2).toLowerCase() : '';
    t.proper = pnList.some((p) => t.stem === p || t.core === p || (p.length >= 2 && t.stem.startsWith(p)))
      || hasTitle(t.stem) || isTitleWord(t.stem) || titledStems.has(t.stem);
    t.ignored = ignored.has(t.stem) || ignored.has(t.core) || (!!t.root && ignored.has(t.root));
    t.first = isFirstPerson(t.core);
    // 어근 반복·메아리 후보: 2글자 이상, 1인칭·고유명사·무시 단어 제외
    t.rootable = t.core.length >= 2 && !!t.root && !t.first && !t.proper && !t.ignored;
  }

  // ---- 문장 분리 ----
  const sentences = [];
  SENT_RE.lastIndex = 0;
  while ((m = SENT_RE.exec(text))) {
    const seg = m[0];
    const trimmed = seg.trim();
    if (!trimmed || !LETTER.test(trimmed)) continue;
    const lead = seg.length - seg.trimStart().length;
    sentences.push({ start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed, tokens: [] });
  }
  let j = 0;
  for (const t of tokens) {
    while (j < sentences.length && sentences[j].end <= t.start) j++;
    if (j < sentences.length && sentences[j].start <= t.start) { t.sent = j; sentences[j].tokens.push(t); }
  }

  // ---- 만연체 ----
  let longCount = 0;
  for (const s of sentences) {
    if (s.text.length > LONG_LIMIT) {
      longCount++;
      add('long', s.start, s.end, { tip: `만연체 ${s.text.length}자 — 호흡을 끊어 보세요` });
    }
  }

  // ---- 종결어미 분포 + 3연속 ----
  const endingCounts = new Map();
  const seq = [];
  for (const s of sentences) {
    const wt = [...s.tokens].reverse().find((t) => t.core);
    if (!wt || !HANGUL_END.test(wt.core)) { seq.push(null); continue; }
    const e = endingOf(wt.core);
    seq.push({ e, tok: wt });
    endingCounts.set(e, (endingCounts.get(e) || 0) + 1);
  }
  const repRuns = [];
  let run = [];
  const flushRun = () => {
    if (run.length >= REP_MIN) {
      repRuns.push({ ending: run[0].e, count: run.length });
      run.forEach((x) => add('rep', x.tok.cs, x.tok.ce, { tip: `"~${x.e}" ${run.length}문장 연속 — 어미를 바꿔 보세요` }));
    }
    run = [];
  };
  for (const x of seq) {
    if (x && run.length && run[0].e === x.e) run.push(x);
    else { flushRun(); if (x) run = [x]; }
  }
  flushRun();
  const endTotal = [...endingCounts.values()].reduce((a, b) => a + b, 0);
  const endings = [...endingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([e, count]) => ({ label: '~' + e, count, ratio: endTotal ? count / endTotal : 0 }));

  // ---- 1인칭 ----
  const fp = tokens.filter((t) => t.first);
  if (fp.length >= FIRST_MIN) fp.forEach((t) => add('first', t.cs, t.ce, { tip: `1인칭 주어 ${fp.length}회 — 주어 생략을 고려해 보세요` }));

  // ---- 고유명사 도배 (6회+) ----
  const properMap = new Map();
  for (const t of tokens) {
    if (!t.core || !t.proper || t.ignored) continue;
    if (!properMap.has(t.stem)) properMap.set(t.stem, []);
    properMap.get(t.stem).push(t);
  }
  const properSpam = [];
  for (const [word, arr] of properMap) {
    if (arr.length >= PROPER_SPAM_MIN) {
      properSpam.push({ word, count: arr.length });
      arr.forEach((t) => add('proper', t.cs, t.ce, { word, tip: `고유명사 "${word}" ${arr.length}회 — 주어 생략·대명사 권장` }));
    }
  }

  // ---- 어근 반복 (3회+) & 4) 근접 메아리 ----
  const rootMap = new Map();
  for (const t of tokens) {
    if (!t.rootable) continue;
    if (!rootMap.has(t.root)) rootMap.set(t.root, []);
    rootMap.get(t.root).push(t);
  }
  const repeatedRoots = [];
  const echoes = [];
  for (const [root, arr] of rootMap) {
    if (arr.length >= ROOT_MIN) {
      repeatedRoots.push({ root, count: arr.length });
      arr.forEach((t) => add('root', t.cs, t.ce, { root, word: t.stem, tip: `어근 "${root}" ${arr.length}회 반복` }));
    } else if (arr.length === 2) {
      const [x, y] = arr;
      const near = (y.cs - x.ce) <= ECHO_DISTANCE || (x.sent >= 0 && y.sent >= 0 && Math.abs(y.sent - x.sent) <= 1);
      if (near) {
        echoes.push({ root, gap: y.cs - x.ce });
        [x, y].forEach((t) => add('echo', t.cs, t.ce, { root, word: t.stem, tip: `근접 메아리 — "${root}"가 가까이서 다시 나와요` }));
      }
    }
  }
  repeatedRoots.sort((a, b) => b.count - a.count);

  // ---- 5) 흐린 어투 ----
  let vagueCount = 0;
  for (const rule of VAGUE_RULES) {
    rule.re.lastIndex = 0;
    while ((m = rule.re.exec(text))) {
      if (rule.test && !rule.test(m)) continue;
      vagueCount++;
      add('vague', m.index, m.index + m[0].length, { tip: `흐린 어투(${rule.label}) — 단정형·능동형 전환 권장` });
    }
  }

  // ---- 습관어 ----
  const habitHits = {};
  const hs = habits.map((h, index) => ({ ...h, index })).filter((h) => h.word).sort((a, b) => b.word.length - a.word.length);
  for (const t of tokens) {
    if (!t.core) continue;
    const h = hs.find((x) => t.core.startsWith(x.word));
    if (h) {
      habitHits[h.word] = (habitHits[h.word] || 0) + 1;
      add('habit', t.cs, t.cs + h.word.length, { habitIndex: h.index, word: h.word, tip: `습관어 "${h.word}" — 눌러서 대체어 선택` });
    }
  }

  // ---- 어휘 다양성 ----
  const cores = tokens.map((t) => t.core.toLowerCase()).filter(Boolean);
  const uniqueCount = new Set(cores).size;
  const diversity = cores.length ? Math.round((uniqueCount / cores.length) * 100) : 0;

  // ---- 항목별 개수 (필터를 꺼도 개수는 보여 줌) ----
  const count = (kind) => marks.filter((x) => x.kind === kind).length;
  const counts = {
    habit: count('habit'),
    root: count('root'),
    echo: echoes.length,
    vague: vagueCount,
    firstPerson: fp.length >= FIRST_MIN ? fp.length : 0,
    endingLong: longCount + repRuns.length,
    properSpam: properSpam.length,
  };

  const visible = marks.filter((x) => on(x.filter));
  visible.forEach((x, i) => { x.id = i; });

  return {
    marks: visible,
    sentences,
    stats: {
      wordCount: cores.length, uniqueCount, diversity, sentenceCount: sentences.length,
      longCount, firstPersonCount: fp.length, repeatedRoots, endings, repRuns, habitHits,
      echoes, vagueCount, properSpam, counts,
    },
  };
}

/**
 * 어투 거울 HTML — 경고 범위를 경계마다 잘라 겹침을 class 조합으로 표현 (중첩 span 없음)
 * 각 조각에는 data-m="경고 id 목록"이 붙어 클릭 시 본문 위치·팝오버를 찾습니다.
 */
export function toHTML(text, a) {
  const marks = a.marks;
  if (!marks.length) return escapeHTML(text) + (text.endsWith('\n') ? ' ' : '');
  const cuts = new Set([0, text.length]);
  marks.forEach((x) => { cuts.add(x.s); cuts.add(x.e); });
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((p, q) => p - q);
  let out = '';
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i], e = points[i + 1];
    const seg = text.slice(s, e);
    const active = marks.filter((x) => x.s <= s && x.e >= e);
    if (!active.length) { out += escapeHTML(seg); continue; }
    active.sort((x, y) => x.prio - y.prio);
    const cls = [...new Set(active.map((x) => x.cls))].join(' ');
    const tip = [...new Set(active.map((x) => x.tip).filter(Boolean))].join(' · ');
    out += `<span class="${cls}" data-m="${active.map((x) => x.id).join(',')}" title="${escapeHTML(tip)}">${escapeHTML(seg)}</span>`;
  }
  if (text.endsWith('\n')) out += ' ';
  return out;
}
