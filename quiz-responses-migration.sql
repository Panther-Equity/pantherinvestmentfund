-- ============================================================
-- Per-question quiz answers (right/wrong detail for admin review)
-- Safe to run anytime. Additive only — no existing table/column touched.
-- Mirrors the existing quiz_attempts / video_progress RLS pattern exactly:
-- students can read/write only their own rows (via their enrollment),
-- staff can read everyone's.
--
-- NOTE: this only captures answers going forward. Any quiz already
-- submitted before this migration has no recoverable per-question data —
-- quiz_scores kept only the final tally, never the individual picks.
-- ============================================================

create table if not exists public.quiz_responses (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_index int not null,
  correct boolean not null,
  created_at timestamptz not null default now(),
  unique (enrollment_id, question_id)
);
alter table public.quiz_responses enable row level security;

drop policy if exists "own responses rw" on public.quiz_responses;
create policy "own responses rw" on public.quiz_responses
  for all using (
    exists (select 1 from public.enrollments e
            where e.id = quiz_responses.enrollment_id and e.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.enrollments e
            where e.id = quiz_responses.enrollment_id and e.user_id = auth.uid())
  );

drop policy if exists "staff read responses" on public.quiz_responses;
create policy "staff read responses" on public.quiz_responses
  for select using (public.is_staff());

-- Verify what landed (optional — run separately to eyeball):
-- select policyname, cmd from pg_policies where tablename = 'quiz_responses' order by cmd;
