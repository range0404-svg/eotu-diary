# 어투의 서재 v2.0

복선 · 본문 · 주석 3구역 일기장 + 어투 교정 거울. 빌드 없음 (HTML / CSS / Vanilla JS ES Modules).

## 업데이트 올리는 법 (GitHub 웹, Git 설치 없이)
1. 크롬에서 **https://github.com/range0404-svg/eotu-diary** 접속
2. 로그아웃 상태면 오른쪽 위 **Sign in** → 아이디(range0404-svg)·비밀번호 로그인 → 저장소 화면으로 돌아옴
   - 바로가기: https://github.com/range0404-svg/eotu-diary/upload/main (로그인 후 업로드 창으로 바로 이동)
3. 저장소 화면 파일 목록 위 **Add file ▾ → Upload files**
4. 파일 탐색기에서 이 폴더 **안의** 바뀐 파일·폴더를 골라 "Drag files here" 칸에 끌어다 놓기 (`.claude` 제외, 폴더째 X)
5. 아래 초록 **Commit changes** 클릭
6. 1~2분 뒤 https://range0404-svg.github.io/eotu-diary/ 에 반영 (앱: ⚙ 설정 → 업데이트 확인)

## 실행
- **로컬:** VS Code에서 `index.html` 우클릭 → *Open with Live Server*
- **배포:** 폴더를 그대로 Vercel에 올리면 됩니다 (Framework: Other, 빌드 명령 없음).
- **안드로이드 앱화:** 배포 주소(HTTPS)를 크롬으로 열고 ⋮ → *홈 화면에 추가*.

> `file://`로 직접 열면 ES 모듈이 막힙니다. 반드시 Live Server나 웹 주소로 여세요.

## 클라우드 동기화 (선택)
키를 넣지 않으면 브라우저 localStorage에만 저장되는 **로컬 모드**로 동작합니다.

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. **SQL Editor**에 [`supabase_setup.sql`](supabase_setup.sql) 전체를 붙여넣고 Run (요약하면 아래와 같음)

```sql
create table public.diary_rows (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,
  primary key (user_id, id)
);
alter table public.diary_rows enable row level security;
create policy "본인 행만" on public.diary_rows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter publication supabase_realtime add table public.diary_rows;
```

3. **Project Settings → API**의 *Project URL*과 *anon public key*를
   - `js/config.js`의 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 두 줄에 넣거나
   - 앱의 **⚙ 설정 → 클라우드 동기화**에 입력
4. 앱이 잠금 화면으로 바뀌면 회원가입/로그인. PC와 안드로이드에서 같은 계정으로 로그인하면 실시간 동기화됩니다.
   - 혼자 쓴다면 가입 후 Supabase **Authentication → Sign In / Providers**에서 *Allow new users to sign up*을 꺼 두세요.

## 단축키 · 명령
| 입력 | 동작 |
|---|---|
| `/지금` | `[HH:MM] ` |
| `/업무` | `#업무 ` |
| `/할일` | `[ ] ` |
| `Esc` 2회 / 👁 | 프라이버시 블러 |
| `Ctrl+K` | 통합 검색 |
| `Ctrl+S` | 즉시 저장 |

## 파일 구조
```
index.html      레이아웃 · 검색/달력/설정 모달 · 모바일 3초 복선 바
style.css       종이/세피아/심야 테마 · PC 2단 · 모바일 반응형
js/storage.js   저장 · 오토세이브 · 되돌리기 · 백업/복구 · Supabase 동기화/로그인
js/analyzer.js  어투 교정 엔진
js/search.js    통합 검색 · 해시태그 · 달력 인덱스
js/ui.js        화면 제어 (진입점)
manifest.json, sw.js, icons/   PWA
```
