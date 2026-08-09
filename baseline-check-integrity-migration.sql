-- baseline-check-integrity-migration.sql
-- Applied to production 2026-08-08.
--
-- @feature: baseline-check-integrity-v1
--
-- WHY THIS EXISTS
-- ---------------
-- One generic retake path was being applied to two items with opposite
-- purposes. A post-course knowledge check is a learning instrument, where a
-- second attempt is appropriate. A pre-course check is a measurement
-- instrument, where a second attempt destroys the thing being measured.
--
-- Two properties of the portal compounded into a hole:
--
--   1. Submitting a check revealed its answers. The player marked every option
--      correct or incorrect on submit, so one blind submission handed over the
--      complete key.
--   2. Retaking a TIMED check hard-deleted the prior attempt: the
--      quiz_attempts, quiz_scores, quiz_responses and completions rows were
--      removed outright, not archived. Both checks in every bootcamp are timed,
--      so both took that path.
--
-- Together: submit blind, read the revealed answers, retake, score full marks.
-- The resulting database is indistinguishable from a clean first attempt, and
-- there is no attempt history to inspect.
--
-- WHAT THIS DOES
-- --------------
-- Adds two per-item switches rather than changing global behaviour, and
-- defaults both to the existing behaviour so nothing changes until an item
-- opts out. Only the four pre-course checks are locked down here.
--
-- KNOWN LIMIT, NOT ADDRESSED HERE
-- -------------------------------
-- LearnPlayer fetches questions with select("*"), which includes answer_index,
-- and scores each check client-side by comparing against it. Hiding the
-- correct/wrong styling therefore stops casual harvesting but does not remove
-- the key from the browser payload, and a client-computed score is written
-- straight to quiz_scores. Closing that properly means scoring server-side and
-- never sending answer_index to a student. Tracked separately.
--
-- Also outstanding: retakes should append with an attempt number rather than
-- delete. Without attempt history there is nothing to audit, and any automated
-- screening of completions has no record to screen.
--
-- This file is safe to re-run.


alter table items add column if not exists reveal_answers boolean not null default true;
alter table items add column if not exists allow_retake   boolean not null default true;

-- Baseline checks: score silently, once.
update items
set reveal_answers = false,
    allow_retake   = false
where type = 'knowledge_check'
  and title ilike '%pre-course%';


-- VERIFICATION
-- Expect the four pre-course checks false/false and the four post-course
-- checks true/true.
--
--   select bootcamp_id, position, title, reveal_answers, allow_retake
--   from items where type = 'knowledge_check'
--   order by bootcamp_id, position;
