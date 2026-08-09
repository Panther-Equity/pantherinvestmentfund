-- @feature: time-based-progress-v1
-- Admin-only "time-based %" progress metric. NEVER shown to students —
-- it deliberately excludes drills/projects (real effort that isn't
-- measurable in-app), so it would be a misleading comparison for them.
--
-- Numerator per item (how much time credit a student has earned):
--   video / project_video : LEAST(furthest_watched_seconds, duration_seconds)
--     (reuses public.video_progress from the no-skip-forward feature)
--   knowledge_check, timed : full time_limit_minutes*60 once submitted, else 0
--   knowledge_check, untimed : excluded entirely (no meaningful time value)
-- Denominator per item (the time "budget"):
--   video / project_video with a known duration_seconds : duration_seconds
--   knowledge_check, timed : time_limit_minutes*60
--   anything else (untimed KC, or a video whose duration isn't captured yet) : excluded
--
-- Run in Supabase SQL Editor. Safe to re-run.

alter table public.items
  add column if not exists duration_seconds numeric; -- null until Preview captures it (video/project_video only)

create or replace view public.enrollment_time_progress
with (security_invoker = true) as
with item_budget as (
  select
    id as item_id,
    bootcamp_id,
    type,
    case
      when type in ('video', 'project_video') then duration_seconds
      when type = 'knowledge_check' and timed then time_limit_minutes * 60
      else null
    end as budget_seconds
  from public.items
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

-- `security_invoker = true` makes the view run as the querying role, so it
-- respects the existing RLS on video_progress / quiz_attempts / enrollments
-- (staff read-all, students read-own) rather than bypassing it. Requires
-- Postgres 15+ (Supabase already runs this). If this line errors on your
-- project for some reason, drop the `with (security_invoker = true)` clause —
-- everything else still works, just double-check who can query it.

-- Fold this into panther-equity-db-setup.sql once verified live, same as
-- video-progress-migration.sql before it.
