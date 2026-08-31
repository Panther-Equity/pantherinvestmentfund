-- questions-answer-key-rls-migration.sql
-- CRIT-4 follow-up, applied to supabase-dev then production, 2026-08-31.
--
-- WHY THIS EXISTS
-- ---------------
-- knowledge-check-integrity-migration.sql fixed scoring (grade_quiz_attempt)
-- and video completion (mark_watched), and LearnPlayer.jsx stopped fetching
-- answer_index. That left one thing unfixed: the RLS policy on `questions`
-- itself.
--
--   create policy "read q" on public.questions
--     as permissive for select to authenticated using (true);
--
-- RLS is row-level, not column-level. This policy makes every ROW of
-- `questions` visible to any authenticated session -- which columns come
-- back is entirely up to whatever select() the caller issues over REST.
-- Removing answer_index from LearnPlayer's own query stopped the app's own
-- UI from asking for it; it did nothing to stop a signed-in student from
-- issuing their own request (browser console, curl with their session's
-- JWT) for exactly that column. The app-level fix and the RLS-level fix
-- are two different things, and only the first one landed initially.
--
-- WHAT THIS DOES
-- --------------
-- questions_for_students: a view exposing only the columns a student
-- legitimately needs (id, item_id, prompt, options, position). Created
-- with default view semantics (no security_invoker), so it runs as its
-- owner and returns rows regardless of the caller's RLS on the base table
-- -- the point is a narrower column set for everyone, not a second row
-- filter.
--
-- The base `questions` table drops "read q" entirely. "staff q" (for all,
-- is_staff()) already covers staff SELECT, so no replacement select policy
-- is needed on the table itself -- it is staff-only now by omission.
--
-- VERIFIED on supabase-dev before this ran on production:
--   - direct select on questions as the owning (non-staff) student:
--     0 rows (previously returned the full row including answer_index)
--   - select on questions_for_students as the same student: returns
--     prompt/options/position, no answer_index column at all
--   - grade_quiz_attempt (SECURITY DEFINER, reads the base table directly)
--     unaffected -- regraded the same fixture correctly after this ran
--
-- This file is safe to re-run.

create or replace view public.questions_for_students as
  select id, item_id, prompt, options, position from public.questions;

grant select on public.questions_for_students to authenticated;

drop policy if exists "read q" on public.questions;


-- VERIFICATION
--   select count(*) from questions_for_students; -- should match questions' row count
--   select policyname, cmd from pg_policies where tablename = 'questions'; -- expect only "staff q" (cmd '*')
