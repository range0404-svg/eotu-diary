// gdrive.js — 구글 드라이브 동기화
// 내 드라이브에 "어투의서재-동기화.json" 파일 하나를 두고, 기기마다 일기별로 병합(최신 우선)해서 주고받습니다.
// 권한은 drive.file: 이 앱이 만든 파일에만 접근하며, 드라이브의 다른 파일은 볼 수 없습니다.
import { GOOGLE_CLIENT_ID } from './config.js';
import * as S from './storage.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = '어투의서재-동기화.json';
const LS_KEY = 'eotu.v2.gdrive';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let tokenClient = null;
let pending = null; // 로그인 팝업 결과를 기다리는 resolve
let status = 'off';
let pushTimer = null;
let busy = false;
let again = false;

const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); }
function setStatus(s, msg = '') { status = s; listeners.forEach((fn) => { try { fn(s, msg); } catch (e) { console.error(e); } }); }
export function getStatus() { return status; }

export const isConfigured = () => !!GOOGLE_CLIENT_ID;
function readState() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function writeState(patch) { const s = { ...readState(), ...patch }; try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* noop */ } return s; }
export const isEnabled = () => !!readState().enabled;
export const lastSync = () => readState().lastSync || 0;
function token() { const s = readState(); return s.token && s.exp > Date.now() + 60_000 ? s.token : null; }
export const hasToken = () => !!token();

function loadGIS() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = GIS_SRC; sc.async = true;
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다'));
    document.head.appendChild(sc);
  });
}

/** 미리 로그인 도구를 준비 (팝업은 버튼 클릭 순간에 바로 열려야 차단되지 않음) */
export async function prepare() {
  if (!isConfigured() || tokenClient) return;
  try {
    await loadGIS();
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        const done = pending; pending = null;
        if (resp.error) { setStatus(isEnabled() ? 'needauth' : 'off', resp.error); done && done(false); return; }
        writeState({ enabled: true, token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        done && done(true);
        syncNow();
      },
      error_callback: (err) => {
        const done = pending; pending = null;
        setStatus(isEnabled() ? 'needauth' : 'off', err && err.type === 'popup_closed' ? '로그인 창을 닫았습니다' : (err && err.type) || '');
        done && done(false);
      },
    });
    if (isEnabled() && !token()) setStatus('needauth');
  } catch (e) {
    console.warn(e);
    setStatus(isEnabled() ? 'error' : 'off', e.message);
  }
}

/** 구글 계정 연결 / 다시 연결 — 반드시 버튼 클릭 이벤트 안에서 호출 */
export function connect() {
  return new Promise((resolve) => {
    if (!isConfigured()) { setStatus('off', 'config.js에 GOOGLE_CLIENT_ID가 없습니다'); resolve(false); return; }
    if (!tokenClient) { prepare(); setStatus('error', '준비 중입니다. 잠시 후 다시 눌러 주세요'); resolve(false); return; }
    pending = resolve;
    tokenClient.requestAccessToken({ prompt: readState().enabled ? '' : 'consent' });
  });
}

export function disconnect() {
  const t = readState().token;
  try { if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* noop */ }
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
  clearTimeout(pushTimer);
  setStatus('off');
}

async function api(url, opt = {}) {
  const t = token();
  if (!t) { setStatus('needauth'); throw new Error('needauth'); }
  const res = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + t } });
  if (res.status === 401) { writeState({ token: null, exp: 0 }); setStatus('needauth'); throw new Error('needauth'); }
  if (!res.ok) throw new Error('Drive ' + res.status);
  return res;
}
async function findFile() {
  const cached = readState().fileId;
  if (cached) return cached;
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await api(`${API}?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id)`);
  const j = await res.json();
  const id = j.files && j.files[0] ? j.files[0].id : null;
  if (id) writeState({ fileId: id });
  return id;
}
async function download(id) { return (await api(`${API}/${id}?alt=media`)).json(); }
async function upload(id, data) {
  const body = JSON.stringify(data);
  if (id) {
    await api(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return id;
  }
  const boundary = 'eotu' + Date.now();
  const meta = { name: FILE_NAME, mimeType: 'application/json', description: '어투의 서재 일기 동기화 파일 — 지우거나 수정하지 마세요' };
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart,
  });
  const j = await res.json();
  writeState({ fileId: j.id });
  return j.id;
}

/** 내려받아 병합 → 이 기기에 더 새로운 게 있으면 올림 */
export async function syncNow() {
  if (!isEnabled()) return;
  if (busy) { again = true; return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (!token()) { setStatus('needauth'); return; }
  busy = true;
  setStatus('syncing');
  try {
    let id = await findFile();
    let remote = null;
    if (id) {
      try { remote = await download(id); }
      catch (e) {
        if (!String(e.message).includes('404')) throw e;
        writeState({ fileId: null }); // 파일이 지워졌으면 다시 찾거나 새로 만듦
        id = await findFile();
        if (id) remote = await download(id);
      }
    }
    const needUpload = remote ? S.mergeExternal(remote).localNewer : true;
    if (needUpload) await upload(id, S.syncSnapshot());
    writeState({ lastSync: Date.now() });
    setStatus('synced');
  } catch (e) {
    if (e.message !== 'needauth') { console.warn('드라이브 동기화 실패', e); setStatus('error', e.message); }
  } finally {
    busy = false;
    if (again) { again = false; schedulePush(1000); }
  }
}
/** 저장 후 잠시 모아서 올림 */
export function schedulePush(delay = 4000) {
  if (!isEnabled() || !token()) { if (isEnabled()) setStatus('needauth'); return; }
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, delay);
}
/** 앱 시작 시 */
export async function start() {
  if (!isConfigured() || !isEnabled()) { setStatus('off'); return; }
  prepare();
  if (token()) await syncNow(); else setStatus('needauth');
}

window.addEventListener('online', () => { if (isEnabled() && token()) syncNow(); });
