-- @feature: no-skip-forward-v1
-- Persistent furthest-watched tracking per enrollment + video item.
-- Mirrors the quiz_attempts pattern already in panther-equity-db-setup.sql.
-- Run in Supabase SQL Editor. Safe to re-run (all guarded with if not exists).

create table if not exists public.video_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  furthest_seconds numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, item_id)
);
alter table public.video_progress enable row level security;

drop policy if exists "own video progress rw" on public.video_progress;
create policy "own video progress rw" on public.video_progress
  for all using (
    exists (select 1 from public.enrollments e
            where e.id = video_progress.enrollment_id and e.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.enrollments e
            where e.id = video_progress.enrollment_id and e.user_id = auth.uid())
  );

drop policy if exists "staff read video progress" on public.video_progress;
create policy "staff read video progress" on public.video_progress
  for select using (public.is_staff());

-- Fold this table + these two policies into panther-equity-db-setup.sql
-- once verified live, so a fresh rebuild includes them.
