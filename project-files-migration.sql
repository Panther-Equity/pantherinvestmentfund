-- @feature: project-files-v1
-- Multiple file attachments per item, replacing the single items.template_path
-- added in video-series-v1. A Project often needs more than one starting file
-- (template + raw data + PIBs), so this is a labelled, ordered list rather than
-- one path.
--
-- Table is deliberately generic (any item type can carry files) even though the
-- builder only exposes the UI on Project items today — avoids a second
-- migration if videos or series ever need attachments too.
--
-- Paths point at objects in the existing `workbooks` storage bucket, same as
-- the bootcamp-level drill workbook. Downloads go through createSignedUrl.
--
-- Purely additive. Run in Supabase SQL Editor. Safe to re-run.
-- No enum change needed — this one runs in a single pass.

-- 1. The files --------------------------------------------------------------

create table if not exists public.item_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  position int not null default 0,
  label text not null default '',
  path text not null,
  created_at timestamptz not null default now()
);

create index if not exists item_files_item_id_position_idx
  on public.item_files (item_id, position);

alter table public.item_files enable row level security;

-- Staff attach the files.
drop policy if exists "staff write item files" on public.item_files;
create policy "staff write item files" on public.item_files
  for all using (public.is_staff()) with check (public.is_staff());

-- Students read files only for bootcamps they're enrolled in.
drop policy if exists "enrolled read item files" on public.item_files;
create policy "enrolled read item files" on public.item_files
  for select using (
    exists (
      select 1
      from public.items i
      join public.enrollments e on e.bootcamp_id = i.bootcamp_id
      where i.id = item_files.item_id and e.user_id = auth.uid()
    )
  );

-- 2. Carry over anything already attached the single-path way ---------------
-- Guarded on not-exists so a re-run can't duplicate rows.

insert into public.item_files (item_id, position, label, path)
select i.id, 0, 'Starting template', i.template_path
from public.items i
where i.template_path is not null
  and not exists (select 1 from public.item_files f where f.item_id = i.id);

-- items.template_path is now DEPRECATED — nothing reads or writes it after
-- this migration. Left in place rather than dropped: harmless, and dropping a
-- column is the kind of thing worth doing deliberately later rather than as a
-- side effect. Remove it when folding into panther-equity-db-setup.sql.

-- Fold item_files into panther-equity-db-setup.sql once verified live.
