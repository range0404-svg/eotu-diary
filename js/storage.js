// storage.js — 저장/불러오기 · 오토세이브 · 되돌리기 · JSON 백업/복구 · Supabase 동기화/로그인
//
// ▼ Supabase 키는 js/config.js에 넣거나, 앱의 [⚙ 설정 → 클라우드 동기화]에서 입력하세요.
//   둘 다 비어 있으면 localStorage 전용(로컬 모드)으로 동작합니다.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const TABLE = 'diary_rows';
const SETTINGS_ID = '__settings__';
const LS_DATA = 'eotu.v2.data';
const LS_CLOUD = 'eotu.v2.cloud';

export const DEFAULT_HABITS = [
  { word: '약간', alternatives: ['다소', '어느 정도', ''] },
  { word: '진짜', alternatives: ['정말', '참으로', ''] },
  { word: '너무', alternatives: ['몹시', '무척', '매우'] },
  { word: '그냥', alternatives: ['별생각 없이', '그대로', ''] },
  { word: '사실', alternatives: ['실은', '알고 보면', ''] },
  { word: '좀', alternatives: ['조금', '다소', ''] },
];

const defaultSettings = () => ({
  habits: JSON.parse(JSON.stringify(DEFAULT_HABITS)),
  theme: 'paper',
  radarOn: true,
  updatedAt: 0,
});

export const state = { diaries: [], settings: defaultSettings() };

// ---------- 이벤트 ----------
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit(type, detail) { listeners.forEach((fn) => { try { fn(type, detail); } catch (e) { console.error(e); } }); }

// ---------- 유틸 ----------
const clone = (o) => JSON.parse(JSON.stringify(o));
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

export function normalizeDiary(d = {}) {
  return {
    id: String(d.id || uid()),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayStr(),
    foreshadow: String(d.foreshadow ?? ''),
    body: String(d.body ?? ''),
    footnote: String(d.footnote ?? ''),
    pinned: !!d.pinned,
    sealed: !!d.sealed,
    sealedAt: String(d.sealedAt ?? ''),
    highlightSentence: String(d.highlightSentence ?? ''),
    updatedAt: Number(d.updatedAt) || Date.now(),
    ...(d.deleted ? { deleted: true } : {}),
  };
}
function normalizeSettings(s = {}) {
  const base = defaultSettings();
  return {
    habits: Array.isArray(s.habits) ? s.habits.filter((h) => h && h.word).map((h) => ({
      word: String(h.word), alternatives: Array.isArray(h.alternatives) ? h.alternatives.map(String) : [''],
    })) : base.habits,
    theme: ['paper', 'sepia', 'dark'].includes(s.theme) ? s.theme : base.theme,
    radarOn: s.radarOn !== undefined ? !!s.radarOn : base.radarOn,
    updatedAt: Number(s.updatedAt) || 0,
  };
}

// ---------- 로컬 저장 ----------
// ⚠ 업데이트 규칙: LS_DATA 키 이름은 절대 바꾸지 말 것. 구조가 바뀌면 DATA_VERSION을 올리고 migrate()에 변환을 추가.
const DATA_VERSION = 1;
const LS_BACKUP_PREFIX = 'eotu.v2.backup.';
const BACKUP_KEEP = 3;

/** 저장 데이터 구조 변환 (이전 버전 → 현재 버전). 데이터를 지우지 말고 변환만 할 것 */
function migrate(data) {
  // let v = data.v || 1;
  // if (v < 2) { ...v1 → v2 변환...; v = 2; }
  data.v = DATA_VERSION;
  return data;
}
function applyData(raw) {
  const data = migrate(JSON.parse(raw));
  state.diaries = (data.diaries || []).map(normalizeDiary);
  state.settings = normalizeSettings(data.settings);
}
function backupKeys() {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(LS_BACKUP_PREFIX)).sort(); }
  catch { return []; }
}
export function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_DATA); } catch { /* noop */ }
  if (raw) {
    try { applyData(raw); return; }
    catch (e) {
      console.warn('로컬 데이터 손상 → 원본 보관 후 자동 백업에서 복구', e);
      try { localStorage.setItem(LS_DATA + '.corrupt-' + Date.now(), raw); } catch { /* noop */ }
    }
  }
  // 본 데이터가 없거나 손상됐으면 가장 최근 자동 백업으로 복구
  for (const k of backupKeys().reverse()) {
    try { applyData(localStorage.getItem(k)); persistLocal(); emit('restored', k); return; }
    catch { /* 다음 백업 시도 */ }
  }
}
/** 처음 실행(데이터·백업 모두 없음, 로컬 모드)일 때만 샘플 일기를 넣음. 넣었으면 개수 반환 */
const LS_SEEDED = 'eotu.v2.seeded';
export function seedSamplesIfFirstRun(buildSamples) {
  try {
    if (localStorage.getItem(LS_SEEDED) || state.diaries.length || backupKeys().length || cloudConfig()) return 0;
    localStorage.setItem(LS_SEEDED, '1');
  } catch { return 0; }
  const list = buildSamples(addDays, todayStr()).map(normalizeDiary);
  state.diaries.push(...list);
  persistLocal();
  return list.length;
}
export function deleteSamples(prefix) {
  const ids = liveDiaries().filter((d) => d.id.startsWith(prefix)).map((d) => d.id);
  ids.forEach(deleteDiary);
  return ids.length;
}

/** 하루 한 번, 덮어쓰기 전 상태를 자동 백업 (최근 3일치 보관) */
function rotateBackup() {
  const key = LS_BACKUP_PREFIX + todayStr();
  if (localStorage.getItem(key)) return;
  const prev = localStorage.getItem(LS_DATA);
  if (!prev) return;
  localStorage.setItem(key, prev);
  const keys = backupKeys();
  while (keys.length > BACKUP_KEEP) localStorage.removeItem(keys.shift());
}
function persistLocal() {
  const json = JSON.stringify({ v: DATA_VERSION, diaries: state.diaries, settings: state.settings });
  try { rotateBackup(); } catch { /* 백업 실패는 본 저장을 막지 않음 */ }
  try { localStorage.setItem(LS_DATA, json); }
  catch (e) {
    // 용량 부족이면 오래된 백업부터 지우고 재시도
    backupKeys().forEach((k) => localStorage.removeItem(k));
    try { localStorage.setItem(LS_DATA, json); }
    catch (e2) { console.warn('로컬 저장 실패', e2); emit('sync', 'error'); }
  }
}
/** 브라우저가 저장 공간을 임의로 비우지 않도록 '영구 저장' 요청 */
export async function requestPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export function liveDiaries() { return state.diaries.filter((d) => !d.deleted); }
export function getDiary(id) { return state.diaries.find((d) => d.id === id && !d.deleted) || null; }

const OPEN_TODO = /^\s*(?:[-*]\s*)?\[ \]/;

/** 새 일기 생성 + 직전 일기의 미완료 복선 자동 이월 */
export function createDiary(date = todayStr()) {
  const prev = liveDiaries()
    .filter((d) => d.date < date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)[0];
  const carried = prev ? prev.foreshadow.split('\n').filter((l) => OPEN_TODO.test(l)) : [];
  const d = normalizeDiary({ id: uid(), date, foreshadow: carried.join('\n') });
  saveDiary(d);
  baseline.set(d.id, clone(d));
  return { diary: d, carried: carried.length, from: prev ? prev.date : null };
}

export function saveDiary(d) {
  d.updatedAt = Date.now();
  const i = state.diaries.findIndex((x) => x.id === d.id);
  if (i < 0) state.diaries.push(d); else state.diaries[i] = d;
  persistLocal();
  queuePush(d.id);
  emit('local', d.id);
}

export function deleteDiary(id) {
  const d = state.diaries.find((x) => x.id === id);
  if (!d) return;
  cancelPending(id);
  // 동기화를 위해 툼스톤만 남김
  Object.assign(d, { deleted: true, foreshadow: '', body: '', footnote: '', highlightSentence: '' });
  saveDiary(d);
}

// ---------- 오토세이브 & 1단계 되돌리기 ----------
const timers = new Map();    // id -> { t, onSaved }
const baseline = new Map();  // id -> 마지막 저장 상태
const undoSnap = new Map();  // id -> 직전 저장 상태
const UNDO_FIELDS = ['foreshadow', 'body', 'footnote', 'highlightSentence'];

export function markBaseline(d) { baseline.set(d.id, clone(d)); }

function commit(d) {
  const base = baseline.get(d.id);
  if (base && UNDO_FIELDS.some((k) => base[k] !== d[k])) undoSnap.set(d.id, base);
  saveDiary(d);
  baseline.set(d.id, clone(d));
}
export function scheduleSave(d, onSaved, delay = 1500) {
  const p = timers.get(d.id);
  if (p) clearTimeout(p.t);
  const t = setTimeout(() => {
    timers.delete(d.id);
    const cur = getDiary(d.id);
    if (cur) { commit(cur); onSaved && onSaved(); }
  }, delay);
  timers.set(d.id, { t, onSaved });
}
export function hasPending(id) { return timers.has(id); }
function cancelPending(id) { const p = timers.get(id); if (p) { clearTimeout(p.t); timers.delete(id); } }
export function flushSave(id) {
  const p = timers.get(id);
  if (!p) return false;
  clearTimeout(p.t); timers.delete(id);
  const d = getDiary(id);
  if (d) { commit(d); p.onSaved && p.onSaved(); }
  return true;
}
export function flushAll() { [...timers.keys()].forEach(flushSave); }
/** 즉시 저장 (핀/봉인/날짜 등 메타 변경) */
export function saveNow(d) { flushSave(d.id); commit(d); }
export function canUndo(id) { return undoSnap.has(id); }
/** 직전 상태로 1단계 되돌리기 (다시 누르면 되돌리기 취소) */
export function undo(id) {
  flushSave(id);
  const snap = undoSnap.get(id);
  const d = getDiary(id);
  if (!snap || !d || d.sealed) return false;
  const leaving = clone(d);
  UNDO_FIELDS.forEach((k) => { d[k] = snap[k]; });
  saveDiary(d);
  baseline.set(id, clone(d));
  undoSnap.set(id, leaving);
  return true;
}

// ---------- 설정 ----------
export function saveSettings() {
  state.settings.updatedAt = Date.now();
  persistLocal();
  queuePush(SETTINGS_ID);
}

// ---------- 외부 파일 동기화 (구글 드라이브) ----------
/** 동기화 파일에 올릴 전체 데이터 (삭제 기록 포함 → 다른 기기에도 삭제 반영) */
export function syncSnapshot() {
  return { app: 'eotu-library', v: DATA_VERSION, savedAt: Date.now(), diaries: state.diaries, settings: state.settings };
}
/**
 * 동기화 파일 내용을 일기별로 병합 (updatedAt 최신 우선, 어느 쪽도 통째로 덮어쓰지 않음)
 * @returns {{changed:boolean, localNewer:boolean}} changed: 로컬이 바뀜 / localNewer: 파일에 올릴 게 있음
 */
export function mergeExternal(obj) {
  const data = migrate({ ...obj });
  const remote = new Map();
  let changed = false;
  for (const raw of data.diaries || []) {
    const inc = normalizeDiary(raw);
    remote.set(inc.id, inc);
    if (hasPending(inc.id)) continue; // 이 기기에서 입력 중이면 로컬 우선
    const i = state.diaries.findIndex((d) => d.id === inc.id);
    if (i < 0) { state.diaries.push(inc); changed = true; }
    else if (inc.updatedAt > state.diaries[i].updatedAt) { state.diaries[i] = inc; baseline.set(inc.id, clone(inc)); changed = true; }
  }
  let localNewer = state.diaries.some((d) => { const r = remote.get(d.id); return !r || d.updatedAt > r.updatedAt; });
  const rs = data.settings;
  if (rs && Number(rs.updatedAt || 0) > (state.settings.updatedAt || 0)) {
    state.settings = normalizeSettings(rs);
    changed = true;
    emit('remote-settings');
  } else if (state.settings.updatedAt && (!rs || state.settings.updatedAt > Number(rs.updatedAt || 0))) {
    localNewer = true;
  }
  if (changed) { persistLocal(); emit('remote'); }
  return { changed, localNewer };
}

// ---------- JSON 백업 / 복구 ----------
export function exportJSON() {
  return JSON.stringify({
    app: 'eotu-library', version: 2, exportedAt: new Date().toISOString(),
    diaries: liveDiaries(), settings: state.settings,
  }, null, 2);
}
export function importJSON(text) {
  const obj = JSON.parse(text);
  const list = Array.isArray(obj) ? obj : (obj.diaries || []);
  let added = 0, updated = 0;
  for (const raw of list) {
    const inc = normalizeDiary(raw);
    const i = state.diaries.findIndex((d) => d.id === inc.id);
    if (i < 0) { state.diaries.push(inc); added++; queuePush(inc.id, false); }
    else if (inc.updatedAt > state.diaries[i].updatedAt) { state.diaries[i] = inc; updated++; queuePush(inc.id, false); }
  }
  if (obj.settings && Number(obj.settings.updatedAt || 0) >= state.settings.updatedAt) {
    state.settings = normalizeSettings(obj.settings);
    queuePush(SETTINGS_ID, false);
    emit('remote-settings');
  }
  persistLocal();
  flushPush();
  emit('remote');
  return { added, updated };
}

// ---------- Supabase 클라우드 ----------
let sb = null;
let user = null;
let channel = null;
let syncStatus = 'local';
const dirty = new Set();
let pushing = false;

function setSync(s) { syncStatus = s; emit('sync', s); }
export function getSyncStatus() { return syncStatus; }
export function currentUser() { return user; }
export function isCloudReady() { return !!sb; }

export function cloudConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CLOUD) || 'null');
    if (c && c.url && c.key) return { ...c, source: 'settings' };
  } catch { /* noop */ }
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, source: 'code' };
  return null;
}
export function setCloudConfig(url, key) {
  if (!url || !key) localStorage.removeItem(LS_CLOUD);
  else localStorage.setItem(LS_CLOUD, JSON.stringify({ url: url.trim(), key: key.trim() }));
}

export async function initCloud() {
  const cfg = cloudConfig();
  if (!cfg) { setSync('local'); return { mode: 'local' }; }
  try {
    const { createClient } = await import(SUPABASE_CDN);
    sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'eotu.v2.auth' } });
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((_evt, session) => {
      const nu = session ? session.user : null;
      if ((nu && nu.id) === (user && user.id)) { user = nu; return; }
      user = nu;
      // 콜백 안에서 다른 supabase 호출을 await 하지 않도록 분리
      setTimeout(() => { if (user) startSync(); else stopSync(); emit('auth', user); }, 0);
    });
    if (user) await startSync();
    else setSync('local');
    return { mode: 'cloud', user };
  } catch (e) {
    console.warn('Supabase 초기화 실패 → 로컬 모드', e);
    sb = null; setSync('offline');
    return { mode: 'local', error: e };
  }
}

export async function signIn(email, password) {
  if (!sb) return { error: '클라우드가 설정되지 않았습니다.' };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return { error: error ? error.message : null };
}
export async function signUp(email, password) {
  if (!sb) return { error: '클라우드가 설정되지 않았습니다.' };
  const { data, error } = await sb.auth.signUp({ email, password });
  return { error: error ? error.message : null, needConfirm: !error && !data.session };
}
export async function signOut() { if (sb) await sb.auth.signOut(); }

async function startSync() {
  try { await pullAll(); subscribe(); }
  catch (e) { console.warn('동기화 실패', e); setSync('error'); }
}
function stopSync() {
  if (channel && sb) sb.removeChannel(channel);
  channel = null;
  setSync('local');
}

function rowFor(id) {
  if (id === SETTINGS_ID) return { user_id: user.id, id, data: state.settings, updated_at: state.settings.updatedAt || Date.now() };
  const d = state.diaries.find((x) => x.id === id);
  return d ? { user_id: user.id, id, data: d, updated_at: d.updatedAt } : null;
}

async function pullAll() {
  setSync('syncing');
  const { data, error } = await sb.from(TABLE).select('id,data,updated_at');
  if (error) throw error;
  const remote = new Map(data.map((r) => [r.id, r]));
  let changed = false;
  for (const r of data) if (applyRemote(r, false)) changed = true;
  for (const d of state.diaries) {
    const r = remote.get(d.id);
    if (!r || d.updatedAt > Number(r.updated_at)) dirty.add(d.id);
  }
  const rs = remote.get(SETTINGS_ID);
  if (state.settings.updatedAt && (!rs || state.settings.updatedAt > Number(rs.updated_at))) dirty.add(SETTINGS_ID);
  if (changed) { persistLocal(); emit('remote'); }
  setSync('synced');
  await flushPush();
}

/** 원격 행 1개 병합 (최신 updatedAt 우선). 바뀌었으면 true */
function applyRemote(r, notify = true) {
  if (!r || !r.id || !r.data) return false;
  const ts = Number(r.updated_at) || 0;
  if (r.id === SETTINGS_ID) {
    if (ts > (state.settings.updatedAt || 0)) {
      state.settings = normalizeSettings({ ...r.data, updatedAt: ts });
      if (notify) persistLocal();
      emit('remote-settings');
      return true;
    }
    return false;
  }
  if (hasPending(r.id)) return false; // 이 기기에서 입력 중이면 로컬 우선
  const i = state.diaries.findIndex((d) => d.id === r.id);
  if (i >= 0 && state.diaries[i].updatedAt >= ts) return false;
  const inc = normalizeDiary({ ...r.data, updatedAt: ts });
  if (i < 0) state.diaries.push(inc); else state.diaries[i] = inc;
  baseline.set(inc.id, clone(inc));
  if (notify) { persistLocal(); emit('remote', inc.id); }
  return true;
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('diary-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` },
      (payload) => applyRemote(payload.new))
    .subscribe();
}

function queuePush(id, flush = true) {
  if (!sb || !user) return;
  dirty.add(id);
  if (flush) flushPush();
}
async function flushPush() {
  if (pushing || !sb || !user || !dirty.size) return;
  if (!navigator.onLine) { setSync('offline'); return; }
  pushing = true;
  setSync('syncing');
  try {
    while (dirty.size) {
      const ids = [...dirty];
      dirty.clear();
      const rows = ids.map(rowFor).filter(Boolean);
      const { error } = await sb.from(TABLE).upsert(rows, { onConflict: 'user_id,id' });
      if (error) { ids.forEach((id) => dirty.add(id)); throw error; }
    }
    setSync('synced');
  } catch (e) {
    console.warn('업로드 실패', e);
    setSync('error');
  } finally {
    pushing = false;
  }
}

window.addEventListener('online', () => { if (sb && user) pullAll().catch(() => setSync('error')); });
window.addEventListener('offline', () => { if (sb && user) setSync('offline'); });
