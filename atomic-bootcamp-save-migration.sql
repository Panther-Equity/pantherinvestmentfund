-- atomic-bootcamp-save-migration.sql
-- CRIT-3, applied to supabase-dev then production, 2026-08-31.
--
-- WHY THIS EXISTS
-- ---------------
-- BootcampBuilder.jsx's save() ran ~11 sequential, non-transactional
-- round-trips: bootcamp upsert, items upsert, items delete-sweep, three
-- child tables (questions/item_solutions/item_files) each upserted then
-- swept, item_steps upserted then swept. A dropped connection, RLS hiccup,
-- or closed tab mid-sequence could leave those tables agreeing with each
-- other only partially -- an item's row updated but its new questions not
-- yet inserted, or vice versa.
--
-- WHAT THIS DOES
-- --------------
-- save_bootcamp(p_payload jsonb): one Postgres function doing the same
-- upsert-by-id-then-sweep-by-keep-list work, inside one transaction. Either
-- all of it commits or none of it does.
--
-- SECURITY INVOKER (the default -- no `security definer` here), unlike
-- knowledge-check-integrity-migration.sql's two RPCs. Staff already has
-- full RLS-granted access to every table this touches ("staff bc",
-- "staff items", "staff q", "staff sol", "staff write item files",
-- "staff write item steps" are all `for all using (is_staff())`), so there
-- is no privilege gap to bridge. The is_staff() check inside is a clean
-- early exit with a clear message; RLS is still the real enforcement.
--
-- TWO GUARANTEES PRESERVED FROM THE OLD CLIENT CODE, on purpose:
--   1. Stable child ids. questions/item_solutions/item_files/item_steps are
--      upserted BY ID, never delete-then-reinsert. quiz_responses and
--      step_progress have FKs into questions.id/item_steps.id -- minting a
--      fresh id on every save was the CRIT-2 bug already fixed once; this
--      must not reintroduce it.
--   2. Selective column writes. duration_seconds and template_path are
--      never in the UPDATE SET list for items (nor is duration_seconds for
--      item_steps) -- the client doesn't send them, and a blind
--      overwrite-the-row upsert would null out a value Preview mode wrote
--      separately.
--
-- position is no longer a payload field. The JSONB array's own order IS
-- the position; the function assigns it from the loop index.
--
-- VERIFIED on supabase-dev before this ran on production:
--   - initial save of a bootcamp with a knowledge check (2 questions) and a
--     video (1 solution link): all rows landed with matching ids
--   - resave that dropped one question, added a new one, and renamed the
--     video: surviving question kept its id and got the text update; the
--     removed question's id was swept; a pre-existing quiz_responses row
--     referencing the surviving question's id was untouched (FK intact)
--   - duration_seconds set directly in the DB (simulating a Preview
--     capture) survived a resave that never mentioned it
--   - a non-staff caller was rejected with an exception and nothing written
--
-- This file is safe to re-run (create or replace throughout).

create or replace function public.save_bootcamp(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_bc jsonb := p_payload->'bootcamp';
  v_bootcamp_id uuid := (v_bc->>'id')::uuid;
  v_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_item jsonb;
  v_item_ids uuid[] := '{}';
  v_all_q_ids uuid[] := '{}';
  v_all_s_ids uuid[] := '{}';
  v_all_f_ids uuid[] := '{}';
  v_all_st_ids uuid[] := '{}';
  v_series_ids uuid[] := '{}';
  v_pos int := 0;
  v_q jsonb; v_s jsonb; v_f jsonb; v_st jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff can save bootcamp content.';
  end if;
  if v_bootcamp_id is null then
    raise exception 'Missing bootcamp id.';
  end if;

  insert into public.bootcamps (id, name, audience, description, workbook_path, created_by)
  values (
    v_bootcamp_id,
    trim(v_bc->>'name'),
    trim(coalesce(v_bc->>'audience', '')),
    nullif(trim(coalesce(v_bc->>'description', '')), ''),
    v_bc->>'workbook_path',
    auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name,
    audience = excluded.audience,
    description = excluded.description,
    workbook_path = excluded.workbook_path;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_item_ids := array_append(v_item_ids, (v_item->>'id')::uuid);

    insert into public.items (
      id, bootcamp_id, type, title, position, weight,
      video_url, drill_text, intro_text, timed, time_limit_minutes
    ) values (
      (v_item->>'id')::uuid,
      v_bootcamp_id,
      (v_item->>'type')::item_type,
      coalesce(v_item->>'title', ''),
      v_pos,
      coalesce((v_item->>'weight')::int, 1),
      case when v_item->>'type' = 'video' then v_item->>'video_url' else null end,
      case when v_item->>'type' = 'video' then v_item->>'drill_text' else null end,
      case when v_item->>'type' in ('video_series','project_video') then v_item->>'intro_text' else null end,
      case when v_item->>'type' = 'knowledge_check' then coalesce((v_item->>'timed')::boolean, false) else false end,
      case when v_item->>'type' = 'knowledge_check' then coalesce((v_item->>'time_limit_minutes')::int, 30) else 30 end
    )
    on conflict (id) do update set
      bootcamp_id = excluded.bootcamp_id,
      type = excluded.type,
      title = excluded.title,
      position = excluded.position,
      weight = excluded.weight,
      video_url = excluded.video_url,
      drill_text = excluded.drill_text,
      intro_text = excluded.intro_text,
      timed = excluded.timed,
      time_limit_minutes = excluded.time_limit_minutes;

    v_pos := v_pos + 1;
  end loop;

  delete from public.items
  where bootcamp_id = v_bootcamp_id
    and (array_length(v_item_ids,1) is null or not (id = any(v_item_ids)));

  for v_item in select * from jsonb_array_elements(v_items) loop
    declare
      v_item_id uuid := (v_item->>'id')::uuid;
      v_type text := v_item->>'type';
      v_qpos int := 0; v_spos int := 0; v_fpos int := 0; v_stpos int := 0;
    begin
      if v_type = 'knowledge_check' then
        for v_q in select * from jsonb_array_elements(coalesce(v_item->'questions','[]'::jsonb)) loop
          insert into public.questions (id, item_id, prompt, options, answer_index, position)
          values (
            (v_q->>'id')::uuid, v_item_id, coalesce(v_q->>'prompt',''),
            coalesce(v_q->'options', '[]'::jsonb), coalesce((v_q->>'answer_index')::int, 0), v_qpos
          )
          on conflict (id) do update set
            item_id = excluded.item_id, prompt = excluded.prompt,
            options = excluded.options, answer_index = excluded.answer_index, position = excluded.position;
          v_all_q_ids := array_append(v_all_q_ids, (v_q->>'id')::uuid);
          v_qpos := v_qpos + 1;
        end loop;
      end if;

      if v_type in ('video','project_video','video_series') then
        for v_s in select * from jsonb_array_elements(coalesce(v_item->'solutions','[]'::jsonb)) loop
          insert into public.item_solutions (id, item_id, title, url, position)
          values ((v_s->>'id')::uuid, v_item_id, coalesce(v_s->>'title',''), coalesce(v_s->>'url',''), v_spos)
          on conflict (id) do update set
            item_id = excluded.item_id, title = excluded.title, url = excluded.url, position = excluded.position;
          v_all_s_ids := array_append(v_all_s_ids, (v_s->>'id')::uuid);
          v_spos := v_spos + 1;
        end loop;
      end if;

      if v_type in ('project_video','video_series') then
        for v_f in select * from jsonb_array_elements(coalesce(v_item->'files','[]'::jsonb)) loop
          insert into public.item_files (id, item_id, position, label, path, gated)
          values (
            (v_f->>'id')::uuid, v_item_id, v_fpos, coalesce(v_f->>'label',''), v_f->>'path',
            case when v_type = 'project_video' then coalesce((v_f->>'gated')::boolean,false) else false end
          )
          on conflict (id) do update set
            item_id = excluded.item_id, position = excluded.position, label = excluded.label,
            path = excluded.path, gated = excluded.gated;
          v_all_f_ids := array_append(v_all_f_ids, (v_f->>'id')::uuid);
          v_fpos := v_fpos + 1;
        end loop;
      end if;

      if v_type = 'video_series' then
        v_series_ids := array_append(v_series_ids, v_item_id);
        for v_st in select * from jsonb_array_elements(coalesce(v_item->'steps','[]'::jsonb)) loop
          insert into public.item_steps (id, item_id, position, title, video_url, solution_title, solution_url)
          values (
            (v_st->>'id')::uuid, v_item_id, v_stpos, coalesce(v_st->>'title',''),
            v_st->>'video_url', v_st->>'solution_title', v_st->>'solution_url'
          )
          on conflict (id) do update set
            item_id = excluded.item_id, position = excluded.position, title = excluded.title,
            video_url = excluded.video_url, solution_title = excluded.solution_title, solution_url = excluded.solution_url;
          v_all_st_ids := array_append(v_all_st_ids, (v_st->>'id')::uuid);
          v_stpos := v_stpos + 1;
        end loop;
      end if;
    end;
  end loop;

  if array_length(v_item_ids,1) is not null then
    delete from public.questions where item_id = any(v_item_ids)
      and (array_length(v_all_q_ids,1) is null or not (id = any(v_all_q_ids)));
    delete from public.item_solutions where item_id = any(v_item_ids)
      and (array_length(v_all_s_ids,1) is null or not (id = any(v_all_s_ids)));
    delete from public.item_files where item_id = any(v_item_ids)
      and (array_length(v_all_f_ids,1) is null or not (id = any(v_all_f_ids)));
  end if;

  if array_length(v_series_ids,1) is not null then
    delete from public.item_steps where item_id = any(v_series_ids)
      and (array_length(v_all_st_ids,1) is null or not (id = any(v_all_st_ids)));
  end if;

  return jsonb_build_object('ok', true, 'bootcamp_id', v_bootcamp_id);
end;
$function$;

grant execute on function public.save_bootcamp(jsonb) to authenticated;


-- VERIFICATION
--   select proname, prosecdef from pg_proc where proname = 'save_bootcamp'; -- prosecdef should be false (invoker)
