-- audit-cleanup-search-path-and-workbook-gate-migration.sql
-- Two independent findings from the 2026-08-07 audit's remaining subtasks,
-- applied to supabase-dev then production, 2026-08-31.

-- =====================================================================
-- 1. set_updated_at() -- Supabase linter WARN (function_search_path_mutable)
-- =====================================================================
-- Every other function in this schema already sets search_path explicitly;
-- this trigger function was the one exception. No behavior change.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


-- =====================================================================
-- 2. Workbooks storage: enrollment/gating check missing on object read
-- =====================================================================
-- item_files' own row policy ("read item files") already gates a
-- `gated=true` row until the student submits -- but that only protects the
-- ROW. The storage object itself was readable by any signed-in user who
-- knew or guessed the path: the old "workbooks read" policy was just
-- `bucket_id = 'workbooks'`, no further check. A gated project template or
-- solution file's path secrecy was the only thing standing between a
-- student and the answer key.
--
-- CAUGHT WHILE TESTING ON DEV, before this ran anywhere else: a first
-- attempt checked "not exists (select 1 from item_files where path = ...
-- and gated = true)" directly in the storage policy. That query runs under
-- the CALLING student's own session, and item_files' RLS already hides a
-- gated=true row from a student with no unlocking submission -- so the
-- check saw zero matching rows for exactly the population it needed to
-- restrict, and "not exists" was wrongly TRUE, granting access. Same shape
-- of problem is_staff()/is_owner() already solve elsewhere in this schema:
-- the check needs the real row, not the caller's RLS-filtered view of it.
--
-- Fixed with workbook_path_allowed(), SECURITY DEFINER, which sees the true
-- item_files/enrollments/project_submissions state regardless of the
-- caller's own RLS.
--
-- VERIFIED on supabase-dev before this ran on production:
--   - a non-staff, non-submitted student: gated file hidden, ungated file
--     and the plain bootcamp workbook still visible
--   - the same student after a project_submissions row with submitted_at
--     set: both files visible
--   - staff: always visible, regardless of gating or submission

create or replace function public.workbook_path_allowed(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    not exists (select 1 from item_files f where f.path = p_path and f.gated = true)
    or exists (
      select 1
      from item_files f
      join items i on i.id = f.item_id
      join enrollments e on e.bootcamp_id = i.bootcamp_id
      join project_submissions ps on ps.enrollment_id = e.id and ps.item_id = i.id
      where f.path = p_path
        and f.gated = true
        and e.user_id = auth.uid()
        and (ps.submitted_at is not null or ps.unlocked_by_staff)
    );
$function$;

grant execute on function public.workbook_path_allowed(text) to authenticated;

drop policy if exists "workbooks read" on storage.objects;
drop policy if exists "workbooks read gated" on storage.objects;
create policy "workbooks read gated" on storage.objects
  as permissive for select to authenticated
  using (
    bucket_id = 'workbooks' and (is_staff() or public.workbook_path_allowed(storage.objects.name))
  );


-- VERIFICATION
--   select proname, prosecdef from pg_proc where proname in ('set_updated_at','workbook_path_allowed');
--   -- expect set_updated_at prosecdef=false, workbook_path_allowed prosecdef=true
--   select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'workbooks%';
--   -- expect exactly: workbooks delete, workbooks insert, workbooks read gated, workbooks update
