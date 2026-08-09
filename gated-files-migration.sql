-- @feature: gated-files-v1
-- Solution WORKBOOKS need the same wall as solution videos.
--
-- project-submit-gate-v1 gated item_solutions (label + URL rows), which covers a
-- solution video. It does not cover item_files, so a solution workbook attached
-- as a file was visible immediately. That was acceptable only while the plan was
-- "the solution is a video"; with solution recordings still to come for Intro to
-- Comps and Intro to DCF, the workbook IS the solution, and it needs gating.
--
-- Approach: a per-file `gated` flag rather than gating all files on a Project.
-- Templates, raw data and PIBs must stay visible from the start; only the
-- flagged rows sit behind the confirmation.
--
-- Enforced in the DATABASE via a RESTRICTIVE policy, same as the solutions gate:
-- an unconfirmed student's request returns no row at all for a gated file, so
-- neither the label nor the storage path reaches the browser.
--
-- Purely additive. Run in Supabase SQL Editor. Safe to re-run. Single pass.

-- 1. The flag ---------------------------------------------------------------

alter table public.item_files
  add column if not exists gated boolean not null default false;

-- 2. The gate ---------------------------------------------------------------
-- RESTRICTIVE, so it ANDs with whatever permissive read policy item_files
-- already has. Three ways through: you're staff, the file isn't flagged, or the
-- student has confirmed their attempt (or been unlocked by staff).
--
-- NOTE: this is item-type agnostic, but only Project items have a way for a
-- student to confirm. A gated file on a video series would therefore stay hidden
-- forever, which is why the builder only exposes the Gated checkbox on Projects.

drop policy if exists "gate flagged files until submitted" on public.item_files;
create policy "gate flagged files until submitted" on public.item_files
  as restrictive
  for select using (
    public.is_staff()
    or gated = false
    or exists (
      select 1
      from public.items i
      join public.enrollments e on e.bootcamp_id = i.bootcamp_id
      join public.project_submissions ps
        on ps.enrollment_id = e.id and ps.item_id = i.id
      where i.id = item_files.item_id
        and e.user_id = auth.uid()
        and (ps.submitted_at is not null or ps.unlocked_by_staff)
    )
  );

-- Fold the `gated` column and this policy into panther-equity-db-setup.sql
-- once verified live.
