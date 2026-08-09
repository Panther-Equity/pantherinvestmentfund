-- @feature: project-submit-gate-v1
-- Two changes to Projects:
--   1. They no longer carry their own video (a Project is a build exercise, not
--      a lecture).
--   2. The solution walkthrough is unreadable until the student has submitted
--      their work — or staff has manually unlocked it.
--
-- The gate is enforced in the DATABASE, not just the UI. A RESTRICTIVE policy on
-- item_solutions means an unsubmitted student's API request returns no rows for
-- a Project's solutions at all, so opening devtools and reading the network
-- response doesn't reveal the link either. A UI-only gate would not survive
-- thirty seconds of a curious analyst.
--
-- Run in Supabase SQL Editor. Safe to re-run. Single pass, no enum step.

-- 1. Projects no longer carry a video ---------------------------------------
-- Clears stale URLs and — the part that actually matters — stale durations.
-- A Project's duration_seconds was counting toward the enrollment_time_progress
-- budget. With the video gone that budget could never be earned, which would
-- permanently cap those students' time_pct below 100%. Nulling it drops Projects
-- out of the time metric entirely, which is correct: a Project's effort isn't
-- measured in watch time. It still counts toward weighted completion at 2.

update public.items
set video_url = null,
    duration_seconds = null
where type = 'project_video';

-- 2. Submissions ------------------------------------------------------------

create table if not exists public.project_submissions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  path text,      -- null on a staff manual unlock (no file involved)
  filename text,
  submitted_at timestamptz,
  unlocked_by_staff boolean not null default false,
  created_at timestamptz not null default now(),
  unique (enrollment_id, item_id)
);

create index if not exists project_submissions_item_idx
  on public.project_submissions (item_id);

alter table public.project_submissions enable row level security;

-- Students read their own.
drop policy if exists "own submission read" on public.project_submissions;
create policy "own submission read" on public.project_submissions
  for select using (
    exists (select 1 from public.enrollments e
            where e.id = project_submissions.enrollment_id and e.user_id = auth.uid())
  );

-- Students submit / resubmit their own. The `unlocked_by_staff = false` check is
-- the load-bearing part: without it a student could flip their own override
-- flag and unlock the solution having submitted nothing.
drop policy if exists "own submission insert" on public.project_submissions;
create policy "own submission insert" on public.project_submissions
  for insert with check (
    unlocked_by_staff = false
    and exists (select 1 from public.enrollments e
                where e.id = enrollment_id and e.user_id = auth.uid())
  );

drop policy if exists "own submission update" on public.project_submissions;
create policy "own submission update" on public.project_submissions
  for update using (
    exists (select 1 from public.enrollments e
            where e.id = project_submissions.enrollment_id and e.user_id = auth.uid())
  ) with check (
    unlocked_by_staff = false
    and exists (select 1 from public.enrollments e
                where e.id = enrollment_id and e.user_id = auth.uid())
  );

-- Staff see everything and own the manual override.
drop policy if exists "staff manage submissions" on public.project_submissions;
create policy "staff manage submissions" on public.project_submissions
  for all using (public.is_staff()) with check (public.is_staff());

-- 3. The gate ---------------------------------------------------------------
-- RESTRICTIVE, so it ANDs with whatever permissive read policy item_solutions
-- already has — no need to know or replace that existing policy. Non-Project
-- items are entirely unaffected.

drop policy if exists "gate project solutions until submitted" on public.item_solutions;
create policy "gate project solutions until submitted" on public.item_solutions
  as restrictive
  for select using (
    public.is_staff()
    or not exists (
      select 1 from public.items i
      where i.id = item_solutions.item_id and i.type = 'project_video'
    )
    or exists (
      select 1
      from public.items i
      join public.enrollments e on e.bootcamp_id = i.bootcamp_id
      join public.project_submissions ps
        on ps.enrollment_id = e.id and ps.item_id = i.id
      where i.id = item_solutions.item_id
        and e.user_id = auth.uid()
        and (ps.submitted_at is not null or ps.unlocked_by_staff)
    )
  );

-- 4. Storage for submitted files -------------------------------------------
-- A separate private bucket rather than reusing `workbooks`: students need write
-- access here, and `workbooks` holds staff-authored templates and solutions.
-- Path convention: {auth.uid()}/{item_id}/{filename} — the first folder is the
-- owner, which is what these policies key off.

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

drop policy if exists "own submission upload" on storage.objects;
create policy "own submission upload" on storage.objects
  for insert with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own submission replace" on storage.objects;
create policy "own submission replace" on storage.objects
  for update using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own submission read file" on storage.objects;
create policy "own submission read file" on storage.objects
  for select using (
    bucket_id = 'submissions'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );

-- INTERIM: there is no staff review screen yet. Until there is:
--   * see who submitted   -> Table Editor, project_submissions
--   * manually unlock     -> insert a row with the student's enrollment_id,
--                            the item_id, and unlocked_by_staff = true
--   * download a file     -> Storage > submissions > {user_id}/{item_id}/
--
-- Fold project_submissions + these policies into panther-equity-db-setup.sql
-- once verified live.
