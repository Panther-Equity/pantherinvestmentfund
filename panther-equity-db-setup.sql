
-- quiz_attempts (server-anchored timed-KC start time)
alter table public.items
  add column if not exists timed boolean not null default false,
  add column if not exists time_limit_minutes int not null default 30;

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (enrollment_id, item_id)
);
alter table public.quiz_attempts enable row level security;

drop policy if exists "own attempts rw" on public.quiz_attempts;
create policy "own attempts rw" on public.quiz_attempts
  for all using (
    exists (select 1 from public.enrollments e
            where e.id = quiz_attempts.enrollment_id and e.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.enrollments e
            where e.id = quiz_attempts.enrollment_id and e.user_id = auth.uid())
  );
drop policy if exists "staff read attempts" on public.quiz_attempts;
create policy "staff read attempts" on public.quiz_attempts
  for select using (public.is_staff());

-- video_progress (furthest-watched, no-skip-forward)
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
