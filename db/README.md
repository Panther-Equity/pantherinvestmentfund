# Database

The authoritative description of the Training Portal's Postgres database.

**`schema.sql` is the source of truth for structure.** If it and the live
database disagree, that is a bug in one of them and worth resolving before
anything else. The code has always been in git; until 2026-08-12 the database
was not. That was CRIT-1 of the 2026-08-07 full-stack audit, and it is what
this folder exists to close.

> **`schema.sql` is currently STALE, knowingly, as of 2026-08-14.** It does not
> contain `public.file_downloads` (added that day by
> `file-downloads-migration.sql`). Regenerating it properly means re-reading
> `pg_catalog` and rewriting sections 2, 4, 9 and 10, and a half-updated
> authoritative schema is worse than a knowingly-stale one — so it is filed as
> its own task rather than patched by hand. Read this note before trusting the
> file's completeness.

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
5. Then run every file in `migrations/` in order, plus any root-level
   `*-migration.sql` not yet folded into `schema.sql` — currently
   `file-downloads-migration.sql`.
6. Create the first owner: sign up through the app, then in the SQL editor
   `update public.profiles set role = 'owner' where email = '...'`. The
   `profiles_one_owner` unique index allows only one.
7. Point `.env.local` and the Vercel environment variables at the new project.

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

**This blocks any member-upload feature.** If members are ever asked to upload
completed drill workbooks into this bucket, fix the storage policy first — the
gap turns from defence-in-depth into member-authored files readable by any
signed-in user who can guess a path.

---

## What the security linter says

Run `get_advisors` (or Advisors in the dashboard) after any DDL change. As of
2026-08-14, the state is clean where it matters and noisy where it does not:

**Clean:** no multiple-permissive-policy findings, no RLS-disabled tables in
`public`. The policy consolidation work held. `file_downloads` added 2026-08-14
produced no new finding.

**Real, worth fixing:**
- `set_updated_at()` has a mutable `search_path`. Add
  `set search_path to 'public'` in a migration.
- Auth OTP expiry is over an hour. Dashboard toggle, and it governs invite and
  password-reset link lifetime — both are full credentials for an account, so
  the default is longer than it needs to be.

**Real but NOT available on this plan:**
- Leaked-password protection is off, and the linter recommends enabling it.
  **It is a Pro-only feature.** Confirmed 2026-08-14 — an earlier version of
  this file listed it as a dashboard toggle, which it is not on the free tier.
  A linter finding is not the same as an available action; check the plan before
  acting on one.

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
read the database. Several of its inferences were wrong. Recorded here so the
audit is not treated as current on these points.

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
Any successor reading the audit as a complete feature inventory will miss them —
and CRIT-7 is the worked example of the cost: `duplicate()` omitted both, so
copying a blind one-shot baseline check silently produced one that revealed
answers and allowed retakes.

**CRIT-2 was FIXED on 2026-08-08 and this file was wrong about it until
2026-08-14.** The database half is unchanged and still worth knowing:
`quiz_responses_question_id_fkey` is `on delete cascade` against
`questions(id)`, with a `unique (enrollment_id, question_id)` on top, so
deleting a question does destroy its answer history. **But
`BootcampBuilder.save()` no longer deletes and reinserts.** The
`stable-child-ids-v1` change upserts questions, solutions and files by their
existing ids and sweeps only rows the editor no longer holds. Verified in
production on 2026-08-14: a real builder save left all 70 `quiz_responses` rows
and all 40 question UUIDs untouched, fingerprint-identical before and after.

The lesson is worth more than the correction. This file previously said "CRIT-2
is confirmed exactly as described" — and what had actually been confirmed was
the *database* fact, by reading `pg_catalog`. The *code* claim was never
rechecked and had been stale for five days. Two halves of one finding, verified
separately, with only one of them actually verified. When recording a
confirmation, say what it was confirmed against.

---

## Housekeeping

`quiz_responses_backup_20260808` is an ad hoc backup taken before the
`question_id` migration. It has no constraints and no policies, so RLS-on
means only `service_role` can read it. It is inert rather than exposed.
Reconciled 2026-08-14: all 20 of its rows are present in the live
`quiz_responses` table and every referenced question still exists, so nothing
in it is unique. Safe to drop on that basis; if kept, it belongs in a
non-public schema.

**There is still no automated backup, and there will not be one.** Supabase's
free tier has no point-in-time recovery, the dashboard reports no backups, and
backups are not downloadable for free projects at all. Pro was considered and
ruled out on 2026-08-14. `schema.sql` protects the structure; it protects none
of the member data.

The real exposure is not platform failure — it is an unrecoverable mistake. On
2026-08-14 an example `UPDATE` carrying placeholder text overwrote a live
bootcamp description, and it was recoverable only because the original wording
happened to still be readable in a chat transcript. So: an export before every
migration and before each cohort launch is the minimum, and member training
records must not be stored on personal hardware or in a personal repository —
they need a real destination, which is an open decision.
