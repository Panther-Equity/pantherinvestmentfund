-- @feature: video-series-v1
-- A multi-step video walkthrough as ONE course item (e.g. the 12-step DCF
-- model build). One item, many ordered steps; each step carries its own
-- YouTube video + step-solution link. The pinned intro instructions and the
-- shared resource links (Template / Solution pair) live on the parent item so
-- they stay fixed while the student moves between steps.
--
-- Also adds items.template_path for Project items — the starting-point file a
-- student downloads and builds from. Stored in the existing `workbooks`
-- storage bucket, same pattern as the bootcamp-level drill workbook.
--
-- Purely additive: no existing table, column, policy, or row is modified.
-- Run in Supabase SQL Editor. Safe to re-run (everything guarded).
--
-- PREREQUISITE — RUN THIS ONE LINE ON ITS OWN, FIRST:
--
--   alter type public.item_type add value if not exists 'video_series';
--
-- items.type is the enum public.item_type, so 'video_series' must exist as an
-- enum value before anything below can reference it. It has to be a SEPARATE
-- execution, not pasted in with this file: Postgres refuses to use a new enum
-- value inside the same transaction that added it, and the Supabase SQL Editor
-- runs a whole script as one implicit transaction. Run that line, then run this.

-- 1. Parent-item columns ----------------------------------------------------

alter table public.items
  add column if not exists intro_text text;      -- video_series: instructions pinned above the step player

alter table public.items
  add column if not exists template_path text;   -- project_video: starting template in the `workbooks` bucket

-- 2. The steps --------------------------------------------------------------

create table if not exists public.item_steps (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  position int not null default 0,
  title text not null default '',
  video_url text,
  solution_title text,
  solution_url text,
  duration_seconds numeric,  -- null until Preview captures it; mirrors items.duration_seconds
  created_at timestamptz not null default now()
);

create index if not exists item_steps_item_id_position_idx
  on public.item_steps (item_id, position);

alter table public.item_steps enable row level security;

-- Staff author the steps.
drop policy if exists "staff write item steps" on public.item_steps;
create policy "staff write item steps" on public.item_steps
  for all using (public.is_staff()) with check (public.is_staff());

-- Students read steps only for bootcamps they're enrolled in.
drop policy if exists "enrolled read item steps" on public.item_steps;
create policy "enrolled read item steps" on public.item_steps
  for select using (
    exists (
      select 1
      from public.items i
      join public.enrollments e on e.bootcamp_id = i.bootcamp_id
      where i.id = item_steps.item_id and e.user_id = auth.uid()
    )
  );

-- 3. Step-level watch progress ---------------------------------------------
-- Deliberately a separate table from public.video_progress rather than a
-- reworking of it: video_progress is unique on (enrollment_id, item_id), which
-- can't represent many videos under one item. Students are actively writing to
-- that table, so this keeps the new path isolated — a bug here cannot corrupt
-- existing no-skip-forward progress. Mirrors video_progress policy-for-policy.

create table if not exists public.step_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  step_id uuid not null references public.item_steps(id) on delete cascade,
  furthest_seconds numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);
alter table public.step_progress enable row level security;

drop policy if exists "own step progress rw" on public.step_progress;
create policy "own step progress rw" on public.step_progress
  for all using (
    exists (select 1 from public.enrollments e
            where e.id = step_progress.enrollment_id and e.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.enrollments e
            where e.id = step_progress.enrollment_id and e.user_id = auth.uid())
  );

drop policy if exists "staff read step progress" on public.step_progress;
create policy "staff read step progress" on public.step_progress
  for select using (public.is_staff());

-- 4. Teach the admin time-progress view about series ------------------------
-- Without this, a video_series contributes NOTHING to enrollment_time_progress
-- (the old view hardcodes type in ('video','project_video')), so the DCF build
-- would silently read as 0 effort in the admin metric. Series budget = sum of
-- its steps' durations; earned = sum of per-step furthest-watched, each capped
-- at that step's own duration.

create or replace view public.enrollment_time_progress
with (security_invoker = true) as
with step_budget as (
  select item_id, sum(duration_seconds) as budget_seconds
  from public.item_steps
  where duration_seconds is not null and duration_seconds > 0
  group by item_id
),
item_budget as (
  select
    i.id as item_id,
    i.bootcamp_id,
    i.type,
    case
      when i.type in ('video', 'project_video') then i.duration_seconds
      when i.type = 'video_series' then sb.budget_seconds
      when i.type = 'knowledge_check' and i.timed then i.time_limit_minutes * 60
      else null
    end as budget_seconds
  from public.items i
  left join step_budget sb on sb.item_id = i.id
),
eligible as (
  select * from item_budget where budget_seconds is not null and budget_seconds > 0
),
per_enrollment_item as (
  select
    e.id as enrollment_id,
    ei.item_id,
    ei.budget_seconds,
    case
      when ei.type in ('video', 'project_video') then
        least(coalesce(vp.furthest_seconds, 0), ei.budget_seconds)
      when ei.type = 'video_series' then
        coalesce((
          select sum(least(coalesce(sp.furthest_seconds, 0), s.duration_seconds))
          from public.item_steps s
          left join public.step_progress sp
            on sp.step_id = s.id and sp.enrollment_id = e.id
          where s.item_id = ei.item_id
            and s.duration_seconds is not null
            and s.duration_seconds > 0
        ), 0)
      when ei.type = 'knowledge_check' then
        case when qa.submitted_at is not null then ei.budget_seconds else 0 end
      else 0
    end as earned_seconds
  from public.enrollments e
  join eligible ei on ei.bootcamp_id = e.bootcamp_id
  left join public.video_progress vp on vp.enrollment_id = e.id and vp.item_id = ei.item_id
  left join public.quiz_attempts qa on qa.enrollment_id = e.id and qa.item_id = ei.item_id
)
select
  enrollment_id,
  sum(earned_seconds) as earned_seconds,
  sum(budget_seconds) as budget_seconds,
  case when sum(budget_seconds) > 0
    then round(100.0 * sum(earned_seconds) / sum(budget_seconds))
    else null
  end as time_pct
from per_enrollment_item
group by enrollment_id;

-- Fold item_steps, step_progress, the two new items columns, and this view
-- into panther-equity-db-setup.sql once verified live — same as
-- video-progress-migration.sql and time-progress-migration.sql before it.
