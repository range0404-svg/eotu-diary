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
