-- 어투의 서재 — Supabase 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 [Run] 하세요.
-- 여러 번 실행해도 안전합니다 (이미 있으면 건너뜀).

-- 1) 일기/설정 저장 테이블 (id '__settings__' 행 = 사용자 설정)
create table if not exists public.diary_rows (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

-- 2) 본인 전용 보안 정책 (RLS): 로그인한 본인의 행만 읽기/쓰기 가능
alter table public.diary_rows enable row level security;

drop policy if exists "diary_rows_select_own" on public.diary_rows;
drop policy if exists "diary_rows_insert_own" on public.diary_rows;
drop policy if exists "diary_rows_update_own" on public.diary_rows;
drop policy if exists "diary_rows_delete_own" on public.diary_rows;

create policy "diary_rows_select_own" on public.diary_rows
  for select to authenticated using (auth.uid() = user_id);
create policy "diary_rows_insert_own" on public.diary_rows
  for insert to authenticated with check (auth.uid() = user_id);
create policy "diary_rows_update_own" on public.diary_rows
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "diary_rows_delete_own" on public.diary_rows
  for delete to authenticated using (auth.uid() = user_id);

-- 3) PC ↔ 안드로이드 실시간 동기화 켜기
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'diary_rows'
  ) then
    alter publication supabase_realtime add table public.diary_rows;
  end if;
end $$;

-- 4) (권장) 혼자 쓸 경우: 가입 후 Authentication → Sign In / Providers 에서
--    "Allow new users to sign up" 을 꺼 두면 다른 사람이 가입할 수 없습니다.

-- =====================================================================
-- [v3.0 어투 교정 3세대 — 데이터 필드 안내]
-- 일기/설정은 data(jsonb) 열에 객체 통째로 저장되므로 아래 새 필드는
-- 테이블 구조 변경(ALTER TABLE) 없이 자동으로 함께 동기화됩니다.
--   · 일기 행  data.ignoredWords   : text[]  (이 글에서만 반복 감지 무시)
--   · 설정 행  data.properNouns    : text[]  (id = '__settings__', 영구 고유명사 면제)
--   · 설정 행  data.mirrorFilters  : { habit, root, echo, vague, firstPerson, endingLong, properSpam } (boolean)
--
-- ▼ 이미 테이블을 만든 사용자: 추가로 실행할 필수 SQL은 없습니다.
--   앱이 기존 데이터를 읽을 때 빈 기본값을 자동으로 채웁니다 (js/storage.js migrate).
--
-- ▼ (선택) 대시보드에서 기존 행에도 기본값을 미리 채워 두고 싶다면 아래 주석을 풀고 실행:
-- update public.diary_rows
--   set data = jsonb_set(data, '{ignoredWords}', '[]'::jsonb, true)
--   where id <> '__settings__' and not (data ? 'ignoredWords');
-- update public.diary_rows
--   set data = data
--     || jsonb_build_object('properNouns', coalesce(data->'properNouns', '[]'::jsonb))
--     || jsonb_build_object('mirrorFilters', coalesce(data->'mirrorFilters',
--          '{"habit":true,"root":true,"echo":true,"vague":true,"firstPerson":true,"endingLong":true,"properSpam":true}'::jsonb))
--   where id = '__settings__';
