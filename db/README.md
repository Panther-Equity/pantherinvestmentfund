# Database

The authoritative description of the Training Portal's Postgres database.

**`schema.sql` is the source of truth for structure.** If it and the live
database disagree, that is a bug in one of them and worth resolving before
anything else. The code has always been in git; until 2026-08-12 the database
was not. That was CRIT-1 of the 2026-08-07 full-stack audit, and it is what
this folder exists to close.

---

## The one rule

**Never edit `schema.sql` to change the database.** It describes what exists.

To change the database, add a new numbered file to `migrations/`:

```
migrations/
  001_initial.sql
  002_add_video_series.sql
  003_quiz_responses_question_id.sql
```

Then run it, then regenerate `schema.sql` so it reflects reality again.

Never edit a migration that has already been applied. If it was wrong, write
another one that fixes it. A migration is a historical record of what happened,
not a description of what should be true — that is `schema.sql`'s job.

This matters more with a committee than it did with one developer. Two people
editing the same migration file produces a database nobody can reason about.

---

## Rebuilding from zero

If the Supabase project is lost, or the database is being recreated on the PE
organisation account:

1. Create a new Supabase project. Note the project URL and keys.
2. Open the SQL editor.
3. Paste `schema.sql` and run it. It is ordered so that it runs top to bottom
   without dependency errors: extensions, enums, tables, constraints, indexes,
   functions, triggers, views, RLS, policies, grants, event trigger, storage.
4. Two statements in `schema.sql` need the `postgres` role rather than the
   dashboard's default: `create event trigger ensure_rls` (section 11) and the
   `storage.buckets` insert (section 12). Run them from the SQL editor, which
   connects as `postgres`. If `ensure_rls` is skipped, new tables will be
   created with RLS **off** and no error — that is the one silent failure in
   this whole procedure.
5. Create the first owner: sign up through the app, then in the SQL editor
   `update public.profiles set role = 'owner' where email = '...'`. The
   `profiles_one_owner` unique index allows only one.
6. Point `.env.local` and the Vercel environment variables at the new project.

---

## Completeness

`schema.sql` was reconstructed by reading `pg_catalog` on the live database
rather than by `pg_dump`. The first draft had four gaps; all four were captured
on 2026-08-13 and are now sections 0 and 10–12.

One item is still not read from the live database: the `security_invoker`
setting on `enrollment_progress` and `enrollment_time_progress`. View options
are not exposed by `pg_get_viewdef`. The `alter view` statements at the end of
section 7 are written from the audit's claim, not from observation. Verify in
the dashboard.

Two findings came out of closing the gaps and are worth reading before the next
audit pass.

**`transfer_ownership` is safe, but only just.** `execute` is held by
`postgres` and `service_role` only — not `anon`, not `authenticated`. That
matters because the function validates the *named* current owner and new owner
but never checks that the **caller** is authorised. The grant restriction is
the single thing standing between a signed-in student and demoting the owner.
Do not widen it. Postgres grants `execute` to `PUBLIC` by default on new
functions, so this is easy to undo by accident — which is exactly what happened
to `is_staff()`, `is_owner()`, and the three trigger functions, all of which are
`anon`-executable by default rather than by decision.

**The `workbooks` storage read policy has no enrollment or gating check.** Any
signed-in user can download any object in the bucket if they know its path.
This is not in the 2026-08-07 audit. The `item_files` RLS policy correctly
gates `gated = true` rows behind a project submission — but it protects the
*row*, not the *object*, so for gated project templates the storage path is the
only secret. A student cannot read `item_files` to learn the path, so this is a
defence-in-depth gap rather than an open door. Still: path secrecy is not
access control, and the audit lists the database-enforced solution gate as the
best decision in the codebase. That claim holds for `item_solutions`, whose
URLs are external, and is weaker than it looks for `item_files`.

Fix by mirroring the `item_files` conditions in the storage policy, or by
serving gated files only through server-generated signed URLs. Not urgent, and
not for today — record it and sequence it with CRIT-4, which it resembles: the
gate exists, it is just enforced one layer higher than it should be.

---

## What the security linter says

Run `get_advisors` (or Advisors in the dashboard) after any DDL change. As of
2026-08-12, the state is clean where it matters and noisy where it does not:

**Clean:** no multiple-permissive-policy findings, no RLS-disabled tables in
`public`. The policy consolidation work held.

**Real, worth fixing:**
- `set_updated_at()` has a mutable `search_path`. Add
  `set search_path to 'public'` in a migration.
- Auth OTP expiry is over an hour. Dashboard toggle.
- Leaked-password protection is off. Dashboard toggle, and it also answers
  LOW-11 in the audit.

**Flagged but not real:** the linter reports `handle_new_user()` and
`rls_auto_enable()` as anon-executable `SECURITY DEFINER` functions. They
return `trigger` and `event_trigger` respectively, and PostgREST does not
expose functions with those return types, so neither is actually reachable.
`is_staff()` and `is_owner()` are genuinely exposed but return only a boolean
about the caller, so calling them anonymously returns false and reveals
nothing. The linter checks the definer flag, not reachability — read the
signature before acting on one of these.

---

## Corrections to the 2026-08-07 audit

The audit inferred the schema from what the code queries, because it could not
read the database. Three of its inferences were wrong and one was right for the
wrong reason. Recorded here so the audit is not treated as current on these
points.

**MED-8 (missing indexes) is mostly a non-issue.** The audit could not verify
and guessed the hot paths were unindexed. In fact `enrollments(user_id)` and
`enrollments(bootcamp_id)` both have explicit indexes, and
`completions`, `quiz_scores`, `quiz_attempts`, `video_progress`, and
`step_progress` each carry a unique constraint whose leading column is
`enrollment_id` — which serves the same lookups. What remains is only the
`explain analyze` on `enrollment_time_progress` once there is real data volume.

**MED-7 (no cohort lifecycle) is half done.** `cohorts.archived` already
exists, as `boolean not null default false`. Only `starts_on` / `ends_on` are
missing, and nothing filters archived cohorts out of the pickers yet.

**`items` has two columns the audit does not mention:** `reveal_answers` and
`allow_retake`, both `boolean not null default true`. Added after 2026-08-07.
Any successor reading the audit as a complete feature inventory will miss them.

**CRIT-2 is confirmed exactly as described.**
`quiz_responses_question_id_fkey` is `on delete cascade` against
`questions(id)`, and there is a `unique (enrollment_id, question_id)` on top.
So the delete-then-reinsert in `BootcampBuilder.save()` does destroy answer
history on every bootcamp save. The audit inferred this; it is now verified.

---

## Housekeeping

`quiz_responses_backup_20260808` is an ad hoc backup taken before the
`question_id` migration. It has no constraints and no policies, so RLS-on
means only `service_role` can read it. It is inert rather than exposed. Decide
before launch whether to keep it — if kept, it belongs in a non-public schema;
if dropped, take a real dump first.

**There is still no automated backup.** Supabase's free tier has no
point-in-time recovery and the dashboard reports no backups. `schema.sql`
protects the structure; it protects none of the member data. A `pg_dump` before
each cohort launch and before every migration is the minimum, and member
training records must not be stored on personal hardware or in a personal
repository — they need a real destination.
