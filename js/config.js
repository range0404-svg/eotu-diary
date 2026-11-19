// config.js — Supabase 키 두 줄만 붙여넣으면 클라우드 동기화가 켜집니다.
// Supabase 대시보드 → Project Settings → API 에서 복사하세요.
// 비워 두면 이 기기 안에만 저장하는 로컬 모드로 동작합니다.
// (anon key는 공개되어도 괜찮은 키입니다. 데이터는 supabase_setup.sql의 RLS 정책으로 본인만 접근할 수 있습니다.)

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// ▼ 구글 드라이브 동기화: Google Cloud에서 만든 "웹 애플리케이션" OAuth 클라이언트 ID
//   예: '1234567890-abcdefg.apps.googleusercontent.com'  (공개되어도 괜찮은 값입니다)
export const GOOGLE_CLIENT_ID = '535265047530-1gd4tusj9fl8rjf6qn0eufrvlblecbgb.apps.googleusercontent.com';
