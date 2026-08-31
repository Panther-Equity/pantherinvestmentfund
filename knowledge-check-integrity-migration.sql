-- knowledge-check-integrity-migration.sql
-- CRIT-4: quiz scoring and video-watch completion move server-side.
-- Applied to supabase-dev then production, 2026-08-31.
--
-- WHY THIS EXISTS
-- ---------------
-- Two of the same shape, both named in db/schema.sql's own policy comments
-- as CRIT-4:
--   1. LearnPlayer fetched questions.answer_index to the browser on every
--      load and scored each check client-side against it -- one blind
--      submission handed over the complete key, and quiz_scores/
--      quiz_responses were student-writable with no value validation.
--   2. toggleComplete() let a student upsert a `completions` row for a
--      plain video item directly, bypassing the 90%-watched gate that was
--      enforced only in the UI (watchGateOk / WATCH_THRESHOLD).
--
-- WHAT THIS DOES
-- --------------
-- Two new SECURITY DEFINER RPCs become the only writers of the rows they
-- own. answer_index never leaves the database except inside
-- grade_quiz_attempt's own return value, gated on the item's reveal_answers.
--
--   grade_quiz_attempt(p_enrollment_id, p_item_id, p_responses jsonb)
--     Grades server-side, writes quiz_scores + quiz_responses + completions,
--     finalizes quiz_attempts.submitted_at. Returns score/total/results.
--
--   mark_watched(p_enrollment_id, p_item_id)
--     Checks video_progress.furthest_seconds against items.duration_seconds
--     * 0.9 server-side (fails open when duration is unset, matching the
--     client's existing behaviour exactly), then writes completions.
--
-- RLS: quiz_scores and quiz_responses lose their direct student INSERT
-- (SELECT + DELETE unchanged, so retake() needed no client change).
-- completions loses direct student INSERT specifically for
-- item.type in ('knowledge_check','video') -- video_series and
-- project_video are UNCHANGED, a separate already-flagged gap (series
-- step-watch isn't even persisted server-side yet; project completion
-- riding on an honest click is a smaller, different problem from CRIT-4's
-- "can rewrite the answer key" shape).
--
-- VERIFIED on supabase-dev before this ran on production:
--   - direct INSERT into quiz_scores as the owning student: blocked (RLS,
--     insufficient_privilege)
--   - grade_quiz_attempt with one right / one wrong answer: returned and
--     persisted score=1, total=2, matching the responses given
--   - direct INSERT into completions for a video item as the owning
--     student: blocked
--   - mark_watched with no video_progress row: returned false, wrote nothing
--   - mark_watched after furthest_seconds >= 90% of duration: returned true,
--     wrote the completion
--
-- This file is safe to re-run (create or replace / drop-if-exists throughout).

create or replace function public.grade_quiz_attempt(
  p_enrollment_id uuid,
  p_item_id uuid,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_score int := 0;
  v_total int := 0;
  v_reveal boolean;
  v_results jsonb := '[]'::jsonb;
  q record;
  v_selected int;
  v_correct boolean;
begin
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment_id and e.user_id = auth.uid()
  ) then
    raise exception 'Not your enrollment.';
  end if;

  select (it.reveal_answers is distinct from false) into v_reveal
  from public.items it
  join public.enrollments e on e.bootcamp_id = it.bootcamp_id
  where it.id = p_item_id and e.id = p_enrollment_id and it.type = 'knowledge_check';

  if not found then
    raise exception 'Not a knowledge check for this enrollment.';
  end if;

  delete from public.quiz_responses
  where enrollment_id = p_enrollment_id and item_id = p_item_id;

  for q in select id, answer_index from public.questions where item_id = p_item_id loop
    v_total := v_total + 1;
    v_selected := coalesce((
      select (elem->>'selected_index')::int
      from jsonb_array_elements(p_responses) elem
      where (elem->>'question_id')::uuid = q.id
    ), -1);
    v_correct := (v_selected = q.answer_index);
    if v_correct then v_score := v_score + 1; end if;

    insert into public.quiz_responses (enrollment_id, item_id, question_id, selected_index, correct)
    values (p_enrollment_id, p_item_id, q.id, v_selected, v_correct);

    v_results := v_results || jsonb_build_object(
      'question_id', q.id,
      'selected_index', v_selected,
      'correct', v_correct,
      'answer_index', case when v_reveal then q.answer_index else null end
    );
  end loop;

  insert into public.quiz_scores (enrollment_id, item_id, score, total)
  values (p_enrollment_id, p_item_id, v_score, v_total)
  on conflict (enrollment_id, item_id)
  do update set score = excluded.score, total = excluded.total, submitted_at = now();

  insert into public.completions (enrollment_id, item_id)
  values (p_enrollment_id, p_item_id)
  on conflict (enrollment_id, item_id) do nothing;

  update public.quiz_attempts
  set submitted_at = now()
  where enrollment_id = p_enrollment_id and item_id = p_item_id and submitted_at is null;

  return jsonb_build_object('score', v_score, 'total', v_total, 'reveal_answers', v_reveal, 'results', v_results);
end;
$function$;

grant execute on function public.grade_quiz_attempt(uuid, uuid, jsonb) to authenticated;

create or replace function public.mark_watched(
  p_enrollment_id uuid,
  p_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_duration numeric;
  v_furthest numeric;
  v_ok boolean;
begin
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment_id and e.user_id = auth.uid()
  ) then
    raise exception 'Not your enrollment.';
  end if;

  select i.duration_seconds into v_duration
  from public.items i
  join public.enrollments e on e.bootcamp_id = i.bootcamp_id
  where i.id = p_item_id and e.id = p_enrollment_id and i.type = 'video';

  if not found then
    raise exception 'Not a plain video item for this enrollment.';
  end if;

  if v_duration is null or v_duration <= 0 then
    v_ok := true;
  else
    select furthest_seconds into v_furthest
    from public.video_progress
    where enrollment_id = p_enrollment_id and item_id = p_item_id;
    v_ok := coalesce(v_furthest, 0) >= v_duration * 0.9;
  end if;

  if not v_ok then
    return false;
  end if;

  insert into public.completions (enrollment_id, item_id)
  values (p_enrollment_id, p_item_id)
  on conflict (enrollment_id, item_id) do nothing;

  return true;
end;
$function$;

grant execute on function public.mark_watched(uuid, uuid) to authenticated;

drop policy if exists "scores own" on public.quiz_scores;
drop policy if exists "scores read own" on public.quiz_scores; -- superseded by pre-existing "scores read", same logic
create policy "scores delete own" on public.quiz_scores
  as permissive for delete to public
  using (exists (select 1 from public.enrollments e where e.id = quiz_scores.enrollment_id and e.user_id = auth.uid()));

drop policy if exists "own responses rw" on public.quiz_responses;
drop policy if exists "staff read responses" on public.quiz_responses; -- superseded, new policy below is a superset
create policy "responses read own" on public.quiz_responses
  as permissive for select to public
  using (exists (select 1 from public.enrollments e where e.id = quiz_responses.enrollment_id and e.user_id = auth.uid())
         or public.is_staff());
create policy "responses delete own" on public.quiz_responses
  as permissive for delete to public
  using (exists (select 1 from public.enrollments e where e.id = quiz_responses.enrollment_id and e.user_id = auth.uid()));

drop policy if exists "completions own" on public.completions;
create policy "completions insert own" on public.completions
  as permissive for insert to public
  with check (
    exists (select 1 from public.enrollments e where e.id = completions.enrollment_id and e.user_id = auth.uid())
    and not exists (select 1 from public.items i where i.id = completions.item_id and i.type in ('knowledge_check','video'))
  );
create policy "completions delete own" on public.completions
  as permissive for delete to public
  using (exists (select 1 from public.enrollments e where e.id = completions.enrollment_id and e.user_id = auth.uid()));


-- VERIFICATION
--   select policyname, cmd from pg_policies where tablename in ('quiz_scores','quiz_responses','completions') order by tablename, cmd;
-- Expect: no 'a' (insert) or 'w' (update) row for quiz_scores/quiz_responses;
-- completions 'a' row present but scoped by the item-type subquery above.
