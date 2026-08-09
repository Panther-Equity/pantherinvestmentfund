-- ============================================================
-- v3 — enrollments: allow staff to update + delete (deadline edit + unassign)
-- Safe to run anytime. Idempotent (drop-if-exists then create).
-- Does NOT toggle RLS enablement, so it cannot break existing student/insert access.
-- Adds only permissive staff policies (RLS policies are OR'd), reusing is_staff().
-- ============================================================

drop policy if exists "staff update enrollments" on public.enrollments;
create policy "staff update enrollments" on public.enrollments
  for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff delete enrollments" on public.enrollments;
create policy "staff delete enrollments" on public.enrollments
  for delete using (public.is_staff());

-- Verify what landed (optional — run separately to eyeball):
-- select policyname, cmd from pg_policies where tablename = 'enrollments' order by cmd;
