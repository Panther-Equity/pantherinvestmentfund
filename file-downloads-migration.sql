-- file-downloads-migration.sql
-- @feature: file-download-tracking-v1 (2026-08-14)
--
-- Nothing currently records that a workbook or project file was opened.
-- downloadWorkbook() and downloadFile() in LearnPlayer both mint a signed URL
-- and window.open it: no insert, no log, no row. So there is no way to tell
-- whether the drill workbook is being opened at all.
--
-- The primary value is product signal, not integrity. If most of 175 members
-- never open the workbook, the drills are not landing, and that is a content
-- problem worth knowing about. Secondary: the completion-integrity screening
-- idea currently has no download signal to work with.
--
-- Append-only by design. A repeat download is a real event, so there is no
-- unique constraint and no upsert — and consequently no UPDATE or DELETE policy
-- below, which is what append-only means in RLS terms. service_role bypasses RLS
-- if a cleanup is ever genuinely needed.

begin;

create table if not exists public.file_downloads (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.enrollments(id) on delete cascade,
  -- null means the bootcamp-level drill workbook rather than an item's file.
  item_id        uuid references public.items(id) on delete cascade,
  path           text not null,
  downloaded_at  timestamptz not null default now()
);

-- The obvious query is "what has this member downloaded", and there is no
-- unique constraint here whose leading column would cover it.
create index if not exists file_downloads_enrollment_id_idx
  on public.file_downloads (enrollment_id);

-- And the inverse: "who has downloaded this file".
create index if not exists file_downloads_item_id_idx
  on public.file_downloads (item_id);

-- The rls_auto_enable event trigger already turns RLS on for new tables. Stated
-- explicitly anyway, because a table whose protection depends on a trigger
-- nobody remembers is a table that ends up unprotected after a restore.
alter table public.file_downloads enable row level security;

-- ONE POLICY PER COMMAND, with the branching inside the USING clause.
--
-- Permissive policies are combined with OR, so layering a second permissive
-- policy on the same command widens access to the union of both — which is
-- exactly how the gated-files check got silently defeated (see
-- rls-consolidation-migration.sql). Writing "own OR staff" in a single clause
-- makes the effective rule readable in one place instead of being an emergent
-- property of two.
drop policy if exists "file downloads read" on public.file_downloads;
create policy "file downloads read"
  on public.file_downloads
  for select
  using (
    is_staff()
    or exists (
      select 1 from public.enrollments e
      where e.id = file_downloads.enrollment_id
        and e.user_id = auth.uid()
    )
  );

-- Students log their own downloads only. Staff are deliberately NOT granted
-- insert: a staff-authored download row would be indistinguishable from a real
-- one, and this table's whole purpose is to be evidence.
drop policy if exists "file downloads insert own" on public.file_downloads;
create policy "file downloads insert own"
  on public.file_downloads
  for insert
  with check (
    exists (
      select 1 from public.enrollments e
      where e.id = file_downloads.enrollment_id
        and e.user_id = auth.uid()
    )
  );

commit;

-- Verify after running:
--
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'file_downloads';
--
-- Expect exactly two rows: one SELECT, one INSERT. If more appear, something
-- added a second permissive policy and the effective grant is now the union.
