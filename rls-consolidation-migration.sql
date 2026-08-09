-- rls-consolidation-migration.sql
-- Applied to production 2026-08-08.
--
-- @feature: gated-files-v1 (corrective)
--
-- WHY THIS EXISTS
-- ---------------
-- gated-files-v1 shipped a policy named "gate flagged files until submitted"
-- that correctly withheld a solution file until the student had a matching
-- project_submissions row. It never worked. An older policy, "enrolled read
-- item files", sat beside it granting every enrolled student read on every
-- file of an item with no reference to the `gated` column at all.
--
-- PostgreSQL combines PERMISSIVE policies for the same command with OR, not
-- AND. A student only has to satisfy one. So the broad policy answered first
-- and the gate was never consulted — gated solution files were readable by
-- any enrolled member without submitting anything. The same mistake, worse,
-- existed on item_solutions: a policy named "read sol" with a USING clause of
-- literal `true`, which made every project solution walkthrough URL in the
-- portal readable by any authenticated user.
--
-- THE INVARIANT
-- -------------
-- Additive RLS policies only ever widen access. A restrictive policy placed
-- next to a permissive one accomplishes nothing. Therefore: ONE permissive
-- policy per table per command, with all branching inside its USING clause.
-- Do not add a second SELECT policy to these tables to "further restrict"
-- something — edit this one.
--
-- ORDERING NOTE
-- -------------
-- The submitted_at default must exist before the tightened policy does. The
-- gate predicate requires submitted_at IS NOT NULL, and the client insert in
-- LearnPlayer.jsx does not set it. Without the default, a student who confirms
-- their attempt writes a NULL and is locked out of the file their own
-- submission was supposed to release. The default is deliberately at the
-- database layer rather than in the client so that no future caller — another
-- component, a script, a backfill — can omit it.
--
-- This file is safe to re-run.


-- 1. submitted_at is the field the gate predicate reads. Default it so no
--    caller can create a submission that fails to unlock its own content.
alter table project_submissions
  alter column submitted_at set default now();

-- 2. Backfill rows written before the default existed. created_at is the
--    honest timestamp for these — it's when the student clicked confirm.
update project_submissions
set submitted_at = created_at
where submitted_at is null;


-- 3. item_solutions: remove the blanket-true read. The gating policy
--    "gate project solutions until submitted" already handles both the
--    project and non-project cases and becomes effective once this is gone.
drop policy if exists "read sol" on item_solutions;


-- 4. item_files: collapse two overlapping SELECT policies into one.
--    Branching that used to be spread across two OR'd policies now lives
--    inside a single USING clause, where it actually constrains.
drop policy if exists "enrolled read item files" on item_files;
drop policy if exists "gate flagged files until submitted" on item_files;
drop policy if exists "read item files" on item_files;

create policy "read item files" on item_files for select
using (
  -- Staff see everything, including gated solutions, so the bootcamp builder
  -- can still list and edit them.
  is_staff()
  or exists (
    select 1
    from items i
    join enrollments e on e.bootcamp_id = i.bootcamp_id
    where i.id = item_files.item_id
      and e.user_id = auth.uid()
      and (
        -- Ungated files: enrollment is sufficient. Note the enrollment join is
        -- what stops ungated files leaking across bootcamps a user isn't in —
        -- the superseded gate policy checked `gated = false` with no
        -- enrollment test, so any authenticated user could read them.
        item_files.gated = false
        -- Gated files: require a submission on THIS item by THIS enrollment,
        -- either self-attested or released by staff.
        or exists (
          select 1
          from project_submissions ps
          where ps.enrollment_id = e.id
            and ps.item_id = i.id
            and (ps.submitted_at is not null or ps.unlocked_by_staff)
        )
      )
  )
);


-- VERIFICATION
-- Expect exactly one SELECT policy on item_files ("read item files") plus the
-- staff ALL policy, and no policy on item_solutions with qual = 'true'.
--
--   select tablename, policyname, cmd, qual
--   from pg_policies
--   where tablename in ('item_files', 'item_solutions')
--   order by tablename, policyname;
--
-- Expect no nulls:
--
--   select count(*) from project_submissions where submitted_at is null;
