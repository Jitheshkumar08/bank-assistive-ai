-- Official fee schedules (transcribed from published Nitte fee documents) and the fee category of an admission record.
-- Additive only: no existing rows or columns are changed.
CREATE TYPE "FeeCategory" AS ENUM ('GENERAL', 'SCHOLARSHIP', 'NRI');

-- AlterTable
ALTER TABLE "AdmissionRecord" ADD COLUMN "feeCategory" "FeeCategory";

-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" UUID NOT NULL,
    "institutionId" VARCHAR(40) NOT NULL,
    "admissionYear" INTEGER NOT NULL,
    "academicYear" VARCHAR(9) NOT NULL,
    "programName" VARCHAR(160) NOT NULL,
    "programKey" VARCHAR(160) NOT NULL,
    "aliasKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" "FeeCategory" NOT NULL,
    "annualTuition" INTEGER,
    "annualExamFee" INTEGER NOT NULL,
    "sourceUrl" VARCHAR(300) NOT NULL,
    "sourceSha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeSchedule_institutionId_admissionYear_programKey_category_key" ON "FeeSchedule"("institutionId", "admissionYear", "programKey", "category");
CREATE INDEX "FeeSchedule_institutionId_admissionYear_idx" ON "FeeSchedule"("institutionId", "admissionYear");

-- AddForeignKey
ALTER TABLE "FeeSchedule" ADD CONSTRAINT "FeeSchedule_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Amounts are whole rupees and never negative.
ALTER TABLE "FeeSchedule" ADD CONSTRAINT "FeeSchedule_amounts_check" CHECK (("annualTuition" IS NULL OR "annualTuition" >= 0) AND "annualExamFee" >= 0);
