-- =====================================================================
-- PE Training Portal - authoritative database schema
-- =====================================================================
-- Generated 2026-08-12 from the live production database (project
-- "PE Training Portal", us-east-1) by reading pg_catalog directly.
--
-- This file replaces the stub panther-equity-db-setup.sql and resolves
-- CRIT-1 of "Training Portal - Full Stack Audit 2026-08-07".
--
-- SCOPE: schema only. No data. Ordered so a rebuild from an empty
-- Supabase project runs top to bottom without dependency errors.
--
-- COMPLETE as of 2026-08-13. The four gaps noted in the first draft
-- (extensions, event trigger, function grants, storage) were captured on
-- 2026-08-13 and are sections 0 and 10-12 below.
--
-- The one item still NOT read from the live database is the
-- `security_invoker` setting on the two views - see the note in section 7.
-- =====================================================================


-- =====================================================================
-- 0. EXTENSIONS
-- =====================================================================
-- Supabase installs these into the `extensions` schema, not `public`.
-- pgcrypto is what backs gen_random_uuid(), used as a default on nearly
-- every table, so it must exist before section 2.
-- plpgsql and supabase_vault are present by default on a new project;
-- listed for completeness.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
-- create extension if not exists plpgsql with schema pg_catalog;      -- default
-- create extension if not exists supabase_vault with schema vault;    -- default


-- =====================================================================
-- 1. ENUM TYPES
-- =====================================================================

create type public.item_type as enum ('knowledge_check', 'video', 'project_video', 'video_series');
create type public.user_role as enum ('owner', 'admin', 'student');
create type public.user_status as enum ('active', 'invited');


-- =====================================================================
-- 2. TABLES
-- =====================================================================
-- Created without foreign keys; all FKs are added in section 3 so that
-- table creation order does not matter.

create table public.profiles (
  id uuid not null,
  full_name text not null default ''::text,
  email text not null,
  role user_role not null default 'student'::user_role,
  status user_status not null default 'active'::user_status,
  created_at timestamp with time zone not null default now()
);

create table public.cohorts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  archived boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create table public.bootcamps (
  id uuid not null default gen_random_uuid(),
  name text not null,
  audience text not null default ''::text,
  workbook_path text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  description text
);

create table public.items (
  id uuid not null default gen_random_uuid(),
  bootcamp_id uuid not null,
  type item_type not null,
  title text not null default ''::text,
  position integer not null default 0,
  weight integer not null default 1,
  video_url text,
  drill_text text,
  timed boolean not null default false,
  time_limit_minutes integer not null default 30,
  duration_seconds numeric,
  intro_text text,
  template_path text,
  reveal_answers boolean not null default true,
  allow_retake boolean not null default true
);

create table public.item_steps (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  position integer not null default 0,
  title text not null default ''::text,
  video_url text,
  solution_title text,
  solution_url text,
  duration_seconds numeric,
  created_at timestamp with time zone not null default now()
);

create table public.item_solutions (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  title text not null default ''::text,
  url text not null default ''::text,
  position integer not null default 0
);

create table public.item_files (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  position integer not null default 0,
  label text not null default ''::text,
  path text not null,
  created_at timestamp with time zone not null default now(),
  gated boolean not null default false
);

create table public.questions (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  prompt text not null default ''::text,
  options jsonb not null default '[]'::jsonb,
  answer_index integer not null default 0,
  position integer not null default 0
);

create table public.enrollments (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  bootcamp_id uuid not null,
  cohort_id uuid,
  deadline date,
  assigned_by uuid,
  assigned_at timestamp with time zone not null default now()
);

create table public.completions (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  item_id uuid not null,
  completed_at timestamp with time zone not null default now()
);

create table public.video_progress (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  item_id uuid not null,
  furthest_seconds numeric not null default 0,
  updated_at timestamp with time zone not null default now()
);

create table public.step_progress (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  step_id uuid not null,
  furthest_seconds numeric not null default 0,
  updated_at timestamp with time zone not null default now()
);

create table public.quiz_attempts (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  item_id uuid not null,
  started_at timestamp with time zone not null default now(),
  submitted_at timestamp with time zone
);

create table public.quiz_scores (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  item_id uuid not null,
  score integer not null,
  total integer not null,
  submitted_at timestamp with time zone not null default now()
);

create table public.quiz_responses (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  item_id uuid not null,
  question_id uuid not null,
  selected_index integer not null,
  correct boolean not null,
  created_at timestamp with time zone not null default now()
);

create table public.project_submissions (
  id uuid not null default gen_random_uuid(),
  enrollment_id uuid not null,
  item_id uuid not null,
  path text,
  filename text,
  submitted_at timestamp with time zone default now(),
  unlocked_by_staff boolean not null default false,
  created_at timestamp with time zone not null default now()
);

-- Ad hoc backup taken 2026-08-08 before the quiz_responses.question_id
-- migration. No constraints, no policies, RLS on - so it is readable
-- only by service_role. Not part of the application schema.
-- Decide whether to keep or drop before launch; see README.
create table public.quiz_responses_backup_20260808 (
  id uuid,
  enrollment_id uuid,
  item_id uuid,
  question_id uuid,
  selected_index integer,
  correct boolean,
  created_at timestamp with time zone
);


-- =====================================================================
-- 3. CONSTRAINTS
-- =====================================================================

-- profiles
alter table public.profiles add constraint profiles_pkey primary key (id);
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

-- cohorts
alter table public.cohorts add constraint cohorts_pkey primary key (id);
alter table public.cohorts add constraint cohorts_name_key unique (name);

-- bootcamps
alter table public.bootcamps add constraint bootcamps_pkey primary key (id);
alter table public.bootcamps add constraint bootcamps_created_by_fkey foreign key (created_by) references profiles(id);

-- items
alter table public.items add constraint items_pkey primary key (id);
alter table public.items add constraint items_bootcamp_id_fkey foreign key (bootcamp_id) references bootcamps(id) on delete cascade;

-- item_steps
alter table public.item_steps add constraint item_steps_pkey primary key (id);
alter table public.item_steps add constraint item_steps_item_id_fkey foreign key (item_id) references items(id) on delete cascade;

-- item_solutions
alter table public.item_solutions add constraint item_solutions_pkey primary key (id);
alter table public.item_solutions add constraint item_solutions_item_id_fkey foreign key (item_id) references items(id) on delete cascade;

-- item_files
alter table public.item_files add constraint item_files_pkey primary key (id);
alter table public.item_files add constraint item_files_item_id_fkey foreign key (item_id) references items(id) on delete cascade;

-- questions
alter table public.questions add constraint questions_pkey primary key (id);
alter table public.questions add constraint questions_item_id_fkey foreign key (item_id) references items(id) on delete cascade;

-- enrollments
alter table public.enrollments add constraint enrollments_pkey primary key (id);
alter table public.enrollments add constraint enrollments_user_id_fkey foreign key (user_id) references profiles(id) on delete cascade;
alter table public.enrollments add constraint enrollments_bootcamp_id_fkey foreign key (bootcamp_id) references bootcamps(id) on delete cascade;
alter table public.enrollments add constraint enrollments_cohort_id_fkey foreign key (cohort_id) references cohorts(id) on delete set null;
alter table public.enrollments add constraint enrollments_assigned_by_fkey foreign key (assigned_by) references profiles(id);
alter table public.enrollments add constraint enrollments_user_id_bootcamp_id_cohort_id_key unique (user_id, bootcamp_id, cohort_id);

-- completions
alter table public.completions add constraint completions_pkey primary key (id);
alter table public.completions add constraint completions_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.completions add constraint completions_item_id_fkey foreign key (item_id) references items(id) on delete cascade;
alter table public.completions add constraint completions_enrollment_id_item_id_key unique (enrollment_id, item_id);

-- video_progress
alter table public.video_progress add constraint video_progress_pkey primary key (id);
alter table public.video_progress add constraint video_progress_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.video_progress add constraint video_progress_item_id_fkey foreign key (item_id) references items(id) on delete cascade;
alter table public.video_progress add constraint video_progress_enrollment_id_item_id_key unique (enrollment_id, item_id);

-- step_progress
alter table public.step_progress add constraint step_progress_pkey primary key (id);
alter table public.step_progress add constraint step_progress_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.step_progress add constraint step_progress_step_id_fkey foreign key (step_id) references item_steps(id) on delete cascade;
alter table public.step_progress add constraint step_progress_enrollment_id_step_id_key unique (enrollment_id, step_id);

-- quiz_attempts
alter table public.quiz_attempts add constraint quiz_attempts_pkey primary key (id);
alter table public.quiz_attempts add constraint quiz_attempts_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.quiz_attempts add constraint quiz_attempts_item_id_fkey foreign key (item_id) references items(id) on delete cascade;
alter table public.quiz_attempts add constraint quiz_attempts_enrollment_id_item_id_key unique (enrollment_id, item_id);

-- quiz_scores
alter table public.quiz_scores add constraint quiz_scores_pkey primary key (id);
alter table public.quiz_scores add constraint quiz_scores_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.quiz_scores add constraint quiz_scores_item_id_fkey foreign key (item_id) references items(id) on delete cascade;
alter table public.quiz_scores add constraint quiz_scores_enrollment_id_item_id_key unique (enrollment_id, item_id);

-- quiz_responses
-- NOTE: question_id cascade-deletes. This is CRIT-2 in the audit - saving a
-- bootcamp deletes and reinserts questions, cascading away all student answer
-- history. Preserved here as-is because this file must describe the database
-- that actually exists. Change it in a numbered migration, not by editing this.
alter table public.quiz_responses add constraint quiz_responses_pkey primary key (id);
alter table public.quiz_responses add constraint quiz_responses_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.quiz_responses add constraint quiz_responses_item_id_fkey foreign key (item_id) references items(id) on delete cascade;
alter table public.quiz_responses add constraint quiz_responses_question_id_fkey foreign key (question_id) references questions(id) on delete cascade;
alter table public.quiz_responses add constraint quiz_responses_enrollment_id_question_id_key unique (enrollment_id, question_id);

-- project_submissions
alter table public.project_submissions add constraint project_submissions_pkey primary key (id);
alter table public.project_submissions add constraint project_submissions_enrollment_id_fkey foreign key (enrollment_id) references enrollments(id) on delete cascade;
alter table public.project_submissions add constraint project_submissions_item_id_fkey foreign key (item_id) references items(id) on delete cascade;
alter table public.project_submissions add constraint project_submissions_enrollment_id_item_id_key unique (enrollment_id, item_id);


-- =====================================================================
-- 4. INDEXES
-- =====================================================================
-- Indexes backing primary keys and unique constraints are created
-- implicitly by section 3 and are not repeated here.

create index enrollments_user_idx on public.enrollments using btree (user_id);
create index enrollments_bootcamp_idx on public.enrollments using btree (bootcamp_id);
create index items_bootcamp_pos_idx on public.items using btree (bootcamp_id, "position");
create index item_steps_item_id_position_idx on public.item_steps using btree (item_id, "position");
create index item_files_item_id_position_idx on public.item_files using btree (item_id, "position");
create index project_submissions_item_idx on public.project_submissions using btree (item_id);

-- Enforces at most one owner across the whole table.
create unique index profiles_one_owner on public.profiles using btree (role) where (role = 'owner'::user_role);


-- =====================================================================
-- 5. FUNCTIONS
-- =====================================================================
-- Must precede policies: is_staff() and is_owner() are referenced by them.

create or replace function public.is_staff()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('owner','admin'));
$function$;

create or replace function public.is_owner()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'owner');
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end; $function$;

-- NOTE: no `set search_path` on this one. Flagged WARN by the Supabase
-- security linter (function_search_path_mutable). Safe to add
-- `set search_path to 'public'` in a migration.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- NOTE: SECURITY DEFINER, returns void, so it WOULD be exposed over the REST
-- rpc endpoint if granted. It validates the *named* current owner and new
-- owner but does NOT verify that the CALLER is authorised.
-- Grants verified 2026-08-13: EXECUTE is held only by postgres and
-- service_role, so it is not reachable by anon or authenticated. That grant
-- restriction (section 10) is the only thing standing between a signed-in
-- student and demoting the owner. Do not widen it. If caller verification is
-- ever added inside the function, this stops being load-bearing.
create or replace function public.transfer_ownership(current_owner uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_owner = new_owner then
    raise exception 'Cannot transfer ownership to the current owner.';
  end if;
  if not exists (select 1 from public.profiles where id = current_owner and role = 'owner') then
    raise exception 'The current owner is not valid.';
  end if;
  if not exists (select 1 from public.profiles where id = new_owner and role = 'admin' and status = 'active') then
    raise exception 'The new owner must be an active admin.';
  end if;
  update public.profiles set role = 'admin' where id = current_owner;
  update public.profiles set role = 'owner' where id = new_owner;
end;
$function$;

-- Event-trigger function: auto-enables RLS on any new table in public.
-- This is why every table in this schema already has RLS on. The binding
-- statement is `create event trigger ensure_rls`, in section 11.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
     if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
     else
        raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     end if;
  end loop;
end;
$function$;


-- =====================================================================
-- 6. TRIGGERS
-- =====================================================================

create trigger bootcamps_set_updated_at
  before update on public.bootcamps
  for each row execute function set_updated_at();

-- Lives on auth.users, not public. Creates the profiles row on signup.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- =====================================================================
-- 7. VIEWS
-- =====================================================================

create view public.enrollment_progress as
 select e.id as enrollment_id,
    e.user_id,
    e.bootcamp_id,
    coalesce(sum(i.weight), 0::bigint) as total_weight,
    coalesce(sum(i.weight) filter (where c.item_id is not null), 0::bigint) as done_weight,
        case
            when coalesce(sum(i.weight), 0::bigint) = 0 then 0::numeric
            else round(100.0 * coalesce(sum(i.weight) filter (where c.item_id is not null), 0::bigint)::numeric / sum(i.weight)::numeric)
        end as pct
   from enrollments e
     join items i on i.bootcamp_id = e.bootcamp_id
     left join completions c on c.enrollment_id = e.id and c.item_id = i.id
  group by e.id, e.user_id, e.bootcamp_id;

create view public.enrollment_time_progress as
 with step_budget as (
         select item_steps.item_id,
            sum(item_steps.duration_seconds) as budget_seconds
           from item_steps
          where item_steps.duration_seconds is not null and item_steps.duration_seconds > 0::numeric
          group by item_steps.item_id
        ), item_budget as (
         select i.id as item_id,
            i.bootcamp_id,
            i.type,
                case
                    when i.type = any (array['video'::item_type, 'project_video'::item_type]) then i.duration_seconds
                    when i.type = 'video_series'::item_type then sb.budget_seconds
                    when i.type = 'knowledge_check'::item_type and i.timed then (i.time_limit_minutes * 60)::numeric
                    else null::numeric
                end as budget_seconds
           from items i
             left join step_budget sb on sb.item_id = i.id
        ), eligible as (
         select item_budget.item_id,
            item_budget.bootcamp_id,
            item_budget.type,
            item_budget.budget_seconds
           from item_budget
          where item_budget.budget_seconds is not null and item_budget.budget_seconds > 0::numeric
        ), per_enrollment_item as (
         select e.id as enrollment_id,
            ei.item_id,
            ei.budget_seconds,
                case
                    when ei.type = any (array['video'::item_type, 'project_video'::item_type]) then least(coalesce(vp.furthest_seconds, 0::numeric), ei.budget_seconds)
                    when ei.type = 'video_series'::item_type then coalesce(( select sum(least(coalesce(sp.furthest_seconds, 0::numeric), s.duration_seconds)) as sum
                       from item_steps s
                         left join step_progress sp on sp.step_id = s.id and sp.enrollment_id = e.id
                      where s.item_id = ei.item_id and s.duration_seconds is not null and s.duration_seconds > 0::numeric), 0::numeric)
                    when ei.type = 'knowledge_check'::item_type then
                    case
                        when qa.submitted_at is not null then ei.budget_seconds
                        else 0::numeric
                    end
                    else 0::numeric
                end as earned_seconds
           from enrollments e
             join eligible ei on ei.bootcamp_id = e.bootcamp_id
             left join video_progress vp on vp.enrollment_id = e.id and vp.item_id = ei.item_id
             left join quiz_attempts qa on qa.enrollment_id = e.id and qa.item_id = ei.item_id
        )
 select enrollment_id,
    sum(earned_seconds) as earned_seconds,
    sum(budget_seconds) as budget_seconds,
        case
            when sum(budget_seconds) > 0::numeric then round(100.0 * sum(earned_seconds) / sum(budget_seconds))
            else null::numeric
        end as time_pct
   from per_enrollment_item
  group by enrollment_id;

-- Makes the views respect the caller's RLS rather than the view owner's.
-- The audit records this as set on enrollment_time_progress. View options are
-- not exposed by pg_get_viewdef, so this pair of statements was NOT read from
-- the live database - verify against the dashboard before relying on it.
alter view public.enrollment_progress set (security_invoker = on);
alter view public.enrollment_time_progress set (security_invoker = on);


-- =====================================================================
-- 8. ROW LEVEL SECURITY
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.cohorts enable row level security;
alter table public.bootcamps enable row level security;
alter table public.items enable row level security;
alter table public.item_steps enable row level security;
alter table public.item_solutions enable row level security;
alter table public.item_files enable row level security;
alter table public.questions enable row level security;
alter table public.enrollments enable row level security;
alter table public.completions enable row level security;
alter table public.video_progress enable row level security;
alter table public.step_progress enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_scores enable row level security;
alter table public.quiz_responses enable row level security;
alter table public.project_submissions enable row level security;
alter table public.quiz_responses_backup_20260808 enable row level security;


-- =====================================================================
-- 9. POLICIES
-- =====================================================================
-- One RESTRICTIVE policy exists (the project-solution gate). RESTRICTIVE
-- policies AND with the permissive set rather than OR-ing into it, which is
-- what makes the gate a real lock instead of a suggestion. Do not convert it.
--
-- quiz_responses_backup_20260808 deliberately has no policy: RLS on with zero
-- policies denies all access except service_role.

-- profiles
create policy "profiles read self or staff" on public.profiles
  as permissive for select to public
  using (((id = auth.uid()) or is_staff()));

create policy "owner inserts profiles" on public.profiles
  as permissive for insert to public
  with check (is_owner());

create policy "owner writes profiles" on public.profiles
  as permissive for update to public
  using (is_owner()) with check (is_owner());

-- cohorts
create policy "read cohorts" on public.cohorts
  as permissive for select to authenticated
  using (true);

create policy "staff cohorts" on public.cohorts
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- bootcamps
create policy "read bc" on public.bootcamps
  as permissive for select to authenticated
  using (true);

create policy "staff bc" on public.bootcamps
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- items
create policy "read items" on public.items
  as permissive for select to authenticated
  using (true);

create policy "staff items" on public.items
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- item_steps
create policy "enrolled read item steps" on public.item_steps
  as permissive for select to public
  using ((exists ( select 1
   from (items i
     join enrollments e on ((e.bootcamp_id = i.bootcamp_id)))
  where ((i.id = item_steps.item_id) and (e.user_id = auth.uid())))));

create policy "staff write item steps" on public.item_steps
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- item_solutions
create policy "staff sol" on public.item_solutions
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- The single best security decision in the codebase. RESTRICTIVE, so it
-- intersects with the permissive set: an unsubmitted student's request returns
-- no row at all, and the solution URL never reaches the browser.
create policy "gate project solutions until submitted" on public.item_solutions
  as restrictive for select to public
  using ((is_staff() or (not (exists ( select 1
   from items i
  where ((i.id = item_solutions.item_id) and (i.type = 'project_video'::item_type))))) or (exists ( select 1
   from ((items i
     join enrollments e on ((e.bootcamp_id = i.bootcamp_id)))
     join project_submissions ps on (((ps.enrollment_id = e.id) and (ps.item_id = i.id))))
  where ((i.id = item_solutions.item_id) and (e.user_id = auth.uid()) and ((ps.submitted_at is not null) or ps.unlocked_by_staff))))));

-- item_files
create policy "read item files" on public.item_files
  as permissive for select to public
  using ((is_staff() or (exists ( select 1
   from (items i
     join enrollments e on ((e.bootcamp_id = i.bootcamp_id)))
  where ((i.id = item_files.item_id) and (e.user_id = auth.uid()) and ((item_files.gated = false) or (exists ( select 1
           from project_submissions ps
          where ((ps.enrollment_id = e.id) and (ps.item_id = i.id) and ((ps.submitted_at is not null) or ps.unlocked_by_staff))))))))));

create policy "staff write item files" on public.item_files
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- questions
-- NOTE: this ships questions.answer_index to every authenticated user. The
-- answer key is readable before submitting, independent of scoring. CRIT-4.
create policy "read q" on public.questions
  as permissive for select to authenticated
  using (true);

create policy "staff q" on public.questions
  as permissive for all to public
  using (is_staff()) with check (is_staff());

-- enrollments
create policy "enroll read own" on public.enrollments
  as permissive for select to public
  using (((user_id = auth.uid()) or is_staff()));

create policy "staff enroll" on public.enrollments
  as permissive for all to public
  using (is_staff()) with check (is_staff());

create policy "staff update enrollments" on public.enrollments
  as permissive for update to public
  using (is_staff()) with check (is_staff());

create policy "staff delete enrollments" on public.enrollments
  as permissive for delete to public
  using (is_staff());

-- completions
create policy "completions read" on public.completions
  as permissive for select to public
  using ((is_staff() or (exists ( select 1
   from enrollments e
  where ((e.id = completions.enrollment_id) and (e.user_id = auth.uid()))))));

create policy "completions own" on public.completions
  as permissive for all to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = completions.enrollment_id) and (e.user_id = auth.uid())))))
  with check ((exists ( select 1
   from enrollments e
  where ((e.id = completions.enrollment_id) and (e.user_id = auth.uid())))));

-- video_progress
create policy "own video progress rw" on public.video_progress
  as permissive for all to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = video_progress.enrollment_id) and (e.user_id = auth.uid())))))
  with check ((exists ( select 1
   from enrollments e
  where ((e.id = video_progress.enrollment_id) and (e.user_id = auth.uid())))));

create policy "staff read video progress" on public.video_progress
  as permissive for select to public
  using (is_staff());

-- step_progress
create policy "own step progress rw" on public.step_progress
  as permissive for all to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = step_progress.enrollment_id) and (e.user_id = auth.uid())))))
  with check ((exists ( select 1
   from enrollments e
  where ((e.id = step_progress.enrollment_id) and (e.user_id = auth.uid())))));

create policy "staff read step progress" on public.step_progress
  as permissive for select to public
  using (is_staff());

-- quiz_attempts
create policy "own attempts rw" on public.quiz_attempts
  as permissive for all to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = quiz_attempts.enrollment_id) and (e.user_id = auth.uid())))))
  with check ((exists ( select 1
   from enrollments e
  where ((e.id = quiz_attempts.enrollment_id) and (e.user_id = auth.uid())))));

create policy "staff read attempts" on public.quiz_attempts
  as permissive for select to public
  using (is_staff());

-- quiz_scores
-- NOTE: `for all` with no value validation. A student can upsert their own
-- score. CRIT-4 - fix by moving scoring server-side and revoking write here.
create policy "scores own" on public.quiz_scores
  as permissive for all to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = quiz_scores.enrollment_id) and (e.user_id = auth.uid())))))
  with check ((exists ( select 1
   from enrollments e
  where ((e.id = quiz_scores.enrollment_id) and (e.user_id = auth.uid())))));

create policy "scores read" on public.quiz_scores
  as permissive for select to public
  using ((is_staff() or (exists ( select 1
   from enrollments e
  where ((e.id = quiz_scores.enrollment_id) and (e.user_id = auth.uid()))))));

-- quiz_responses
-- NOTE: same CRIT-4 exposure. Answer history is student-writable, so it is not
-- a tamper-proof assessment record. Staff see it as one.
create policy "own responses rw" on public.quiz_responses
  as permissive for all to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = quiz_responses.enrollment_id) and (e.user_id = auth.uid())))))
  with check ((exists ( select 1
   from enrollments e
  where ((e.id = quiz_responses.enrollment_id) and (e.user_id = auth.uid())))));

create policy "staff read responses" on public.quiz_responses
  as permissive for select to public
  using (is_staff());

-- project_submissions
create policy "own submission read" on public.project_submissions
  as permissive for select to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = project_submissions.enrollment_id) and (e.user_id = auth.uid())))));

-- unlocked_by_staff = false in the with check is what stops a student
-- unlocking their own solutions having submitted nothing. Keep it.
create policy "own submission insert" on public.project_submissions
  as permissive for insert to public
  with check (((unlocked_by_staff = false) and (exists ( select 1
   from enrollments e
  where ((e.id = project_submissions.enrollment_id) and (e.user_id = auth.uid()))))));

create policy "own submission update" on public.project_submissions
  as permissive for update to public
  using ((exists ( select 1
   from enrollments e
  where ((e.id = project_submissions.enrollment_id) and (e.user_id = auth.uid())))))
  with check (((unlocked_by_staff = false) and (exists ( select 1
   from enrollments e
  where ((e.id = project_submissions.enrollment_id) and (e.user_id = auth.uid()))))));

create policy "staff manage submissions" on public.project_submissions
  as permissive for all to public
  using (is_staff()) with check (is_staff());


-- =====================================================================
-- 10. FUNCTION GRANTS
-- =====================================================================
-- Captured 2026-08-13. Postgres grants EXECUTE to PUBLIC by default on any
-- new function, so the four helper functions below are reachable by `anon`
-- and `authenticated` not by choice but by default.
--
-- transfer_ownership is the exception and the important one: EXECUTE is held
-- only by postgres and service_role. It is NOT callable by anon or
-- authenticated. Since the function verifies the *named* owner but never the
-- *caller*, that restriction is the only thing preventing any signed-in
-- student from demoting the owner. Do not grant it more widely. The
-- /api/transfer-ownership route uses the service role and does not need it.

grant execute on function public.is_staff() to anon, authenticated, service_role;
grant execute on function public.is_owner() to anon, authenticated, service_role;

-- Trigger and event-trigger functions. PostgREST does not expose functions
-- returning `trigger` or `event_trigger`, so these grants are inert - the
-- functions are not reachable over /rest/v1/rpc/ regardless. Kept to match
-- live state rather than because they are needed.
grant execute on function public.handle_new_user() to anon, authenticated, service_role;
grant execute on function public.set_updated_at() to anon, authenticated, service_role;
grant execute on function public.rls_auto_enable() to anon, authenticated, service_role;

-- Deliberately NOT granted to anon or authenticated.
grant execute on function public.transfer_ownership(uuid, uuid) to service_role;


-- =====================================================================
-- 11. EVENT TRIGGER
-- =====================================================================
-- This is why every table in section 2 already has RLS on: any CREATE TABLE
-- in `public` gets RLS enabled automatically. Without this, a rebuilt
-- database silently loses that safety net - a new table would be created
-- with RLS off and no error.
--
-- Requires superuser. On a hosted Supabase project it must be created from
-- the SQL editor as the postgres role.
--
-- Supabase's own event triggers (pgrst_ddl_watch, pgrst_drop_watch,
-- issue_pg_cron_access, issue_pg_graphql_access, issue_pg_net_access,
-- issue_graphql_placeholder) exist on every project and are NOT part of this
-- application schema. Do not recreate them.

create event trigger ensure_rls
  on ddl_command_end
  execute function public.rls_auto_enable();


-- =====================================================================
-- 12. STORAGE
-- =====================================================================
-- TWO buckets, both private. The 2026-08-07 audit mentions only `workbooks`;
-- `submissions` also exists and carries the student upload path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workbooks',   'workbooks',   false, null, null),
       ('submissions', 'submissions', false, null, null)
on conflict (id) do nothing;

-- submissions: per-user folders, keyed on the first path segment being the
-- uploader's uid. A student can read and replace their own files; staff can
-- read all. Note there is no DELETE policy on this bucket at all, so nobody
-- can remove a submitted file through the API - including staff.
create policy "own submission upload" on storage.objects
  as permissive for insert to public
  with check (((bucket_id = 'submissions'::text) and ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "own submission read file" on storage.objects
  as permissive for select to public
  using (((bucket_id = 'submissions'::text) and (((storage.foldername(name))[1] = (auth.uid())::text) or is_staff())));

create policy "own submission replace" on storage.objects
  as permissive for update to public
  using (((bucket_id = 'submissions'::text) and ((storage.foldername(name))[1] = (auth.uid())::text)));

-- workbooks: staff write, all authenticated users read.
--
-- NOTE - NOT IN THE 2026-08-07 AUDIT. The read policy has no enrollment check
-- and no gating check: ANY signed-in user can download ANY object in this
-- bucket if they know its path. The `item_files` table policy (section 9)
-- correctly gates `gated = true` rows behind a project submission, but that
-- policy protects the *row*, not the *object*. So for gated project templates
-- the storage path is the only secret. Path secrecy is not access control.
--
-- This is a defence-in-depth gap rather than an open door - a student cannot
-- read item_files to learn the path - but it means a leaked or guessed path
-- bypasses the gate entirely. Fix by matching the item_files logic in the
-- storage policy, or by moving gated files to a bucket served only through
-- signed URLs generated server-side.
create policy "workbooks read" on storage.objects
  as permissive for select to authenticated
  using ((bucket_id = 'workbooks'::text));

create policy "workbooks insert" on storage.objects
  as permissive for insert to authenticated
  with check (((bucket_id = 'workbooks'::text) and is_staff()));

create policy "workbooks update" on storage.objects
  as permissive for update to authenticated
  using (((bucket_id = 'workbooks'::text) and is_staff()));

create policy "workbooks delete" on storage.objects
  as permissive for delete to authenticated
  using (((bucket_id = 'workbooks'::text) and is_staff()));


-- =====================================================================
-- END
-- =====================================================================
