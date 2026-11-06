-- Roles + staff invitations, admission year on the single shared admissions table, and admission import tracking.
-- Additive only: no table or column is dropped and no data is rewritten. The one DROP INDEX replaces the old
-- (institutionId, nucatReference) unique index with the year-scoped (institutionId, admissionYear, nucatReference) one.

-- Safety guard: "admissionYear" must be NOT NULL and can't be guessed. If official rows already exist, stop here instead
-- of inventing a year: add the column as nullable, backfill it from the official data, then re-run this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AdmissionRecord") OR EXISTS (SELECT 1 FROM "AdmissionImportBatch") THEN
    RAISE EXCEPTION 'AdmissionRecord/AdmissionImportBatch already contain rows: backfill "admissionYear" from the official data before applying this migration (no year is invented automatically).';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('STUDENT', 'COLLEGE_ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "ImportDuplicatePolicy" AS ENUM ('SKIP_EXISTING', 'UPDATE_EXISTING');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('VALID', 'INVALID', 'DUPLICATE_IN_FILE');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('INSERT', 'UPDATE', 'UNCHANGED');

-- CreateEnum
CREATE TYPE "ImportRowResult" AS ENUM ('INSERTED', 'UPDATED', 'SKIPPED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AuditActorType" ADD VALUE 'SUPER_ADMIN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ImportBatchStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "ImportBatchStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "ImportBatchStatus" ADD VALUE 'CANCELLED';

-- DropIndex
DROP INDEX "AdmissionRecord_institutionId_nucatReference_key";

-- AlterTable
ALTER TABLE "AdmissionImportBatch" ADD COLUMN     "admissionYear" INTEGER NOT NULL,
ADD COLUMN     "changedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "columnMapping" JSONB,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "duplicateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duplicatePolicy" "ImportDuplicatePolicy",
ADD COLUMN     "failureReason" VARCHAR(300),
ADD COLUMN     "invalidCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "newCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previewExpiresAt" TIMESTAMP(3),
ADD COLUMN     "skippedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unchangedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AdmissionRecord" ADD COLUMN     "admissionYear" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "StudentAccount" ADD COLUMN     "displayName" VARCHAR(120),
ADD COLUMN     "institutionId" VARCHAR(40),
ADD COLUMN     "role" "AccountRole" NOT NULL DEFAULT 'STUDENT';

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "role" "AccountRole" NOT NULL,
    "institutionId" VARCHAR(40),
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "acceptedAccountId" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionImportRow" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "outcome" "ImportRowOutcome" NOT NULL,
    "action" "ImportRowAction",
    "result" "ImportRowResult",
    "nucatReference" VARCHAR(40),
    "data" JSONB,
    "changes" JSONB,
    "messages" JSONB,
    "existingRecordId" UUID,

    CONSTRAINT "AdmissionImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_acceptedAccountId_key" ON "StaffInvitation"("acceptedAccountId");

-- CreateIndex
CREATE INDEX "StaffInvitation_email_idx" ON "StaffInvitation"("email");

-- CreateIndex
CREATE INDEX "StaffInvitation_role_acceptedAt_revokedAt_idx" ON "StaffInvitation"("role", "acceptedAt", "revokedAt");

-- CreateIndex
CREATE INDEX "AdmissionImportRow_batchId_outcome_idx" ON "AdmissionImportRow"("batchId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionImportRow_batchId_rowNumber_key" ON "AdmissionImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "AdmissionImportBatch_institutionId_admissionYear_idx" ON "AdmissionImportBatch"("institutionId", "admissionYear");

-- CreateIndex
CREATE INDEX "AdmissionRecord_institutionId_nucatReference_idx" ON "AdmissionRecord"("institutionId", "nucatReference");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionRecord_institutionId_admissionYear_nucatReference_key" ON "AdmissionRecord"("institutionId", "admissionYear", "nucatReference");

-- CreateIndex
CREATE INDEX "StudentAccount_role_status_idx" ON "StudentAccount"("role", "status");

-- AddForeignKey
ALTER TABLE "StudentAccount" ADD CONSTRAINT "StudentAccount_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "StudentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_acceptedAccountId_fkey" FOREIGN KEY ("acceptedAccountId") REFERENCES "StudentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionImportBatch" ADD CONSTRAINT "AdmissionImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StudentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionImportRow" ADD CONSTRAINT "AdmissionImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AdmissionImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

