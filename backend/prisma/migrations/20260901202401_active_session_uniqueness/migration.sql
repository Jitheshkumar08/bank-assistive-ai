-- Enforce "at most one ACTIVE visit per user" in the database.
--
-- Previously this was only an application-level assumption: establish()
-- read for an existing active session and then decided whether to
-- insert. Two requests could interleave between the read and the write
-- and both insert, leaving the user with two active visits and making
-- their branch context non-deterministic.

-- 1. Add the column that carries the uniqueness.
ALTER TABLE "sessions" ADD COLUMN "active_user_id" UUID;

-- 2. Close any duplicate ACTIVE visits that already exist, keeping the
--    most recently started one. Without this the unique index below
--    cannot be created. Ordering by started_at then id keeps the result
--    deterministic when two rows share a timestamp.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "started_at" DESC, "id" DESC
    ) AS rn
  FROM "sessions"
  WHERE "status" = 'ACTIVE'
)
UPDATE "sessions" s
SET "status" = 'ENDED',
    "ended_at" = COALESCE(s."ended_at", NOW())
FROM ranked r
WHERE s."id" = r."id"
  AND r.rn > 1;

-- 3. Backfill the surviving ACTIVE visits so existing sessions keep
--    working after deployment.
UPDATE "sessions"
SET "active_user_id" = "user_id"
WHERE "status" = 'ACTIVE';

-- 4. PostgreSQL allows many NULLs in a unique index but only one of
--    each non-null value, so this permits unlimited ENDED rows per user
--    and exactly one ACTIVE row.
CREATE UNIQUE INDEX "sessions_active_user_id_key" ON "sessions"("active_user_id");
