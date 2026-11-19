-- CreateEnum
CREATE TYPE "payee_trust" AS ENUM ('DEMO_SEEDED', 'CUSTOMER_PROVIDED', 'BANK_VERIFIED');

-- CreateEnum
CREATE TYPE "assisted_activity_kind" AS ENUM ('PAYMENT_GUIDANCE', 'DEPOSIT_GUIDANCE', 'WITHDRAWAL_GUIDANCE', 'LOAN_ENQUIRY');

-- CreateEnum
CREATE TYPE "assisted_activity_status" AS ENUM ('STARTED', 'CONFIRMED', 'GUIDANCE_COMPLETED', 'ABANDONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "suggestion_type" AS ENUM ('LAST_PAYMENT', 'RECURRING_TODAY');

-- CreateEnum
CREATE TYPE "suggestion_outcome" AS ENUM ('SHOWN', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "history_provenance" AS ENUM ('DEMO_HISTORY', 'ASSISTED_ACTIVITY', 'BANK_VERIFIED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suggestions_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "payees" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "full_name" TEXT,
    "account_last4" TEXT,
    "trust" "payee_trust" NOT NULL DEFAULT 'CUSTOMER_PROVIDED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_payment_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payee_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_payment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assisted_activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payee_id" UUID,
    "session_id" UUID,
    "branch_id" UUID,
    "kind" "assisted_activity_kind" NOT NULL,
    "status" "assisted_activity_status" NOT NULL DEFAULT 'STARTED',
    "amount_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "workflow_name" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assisted_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_offers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "type" "suggestion_type" NOT NULL,
    "provenance" "history_provenance" NOT NULL,
    "kind" "assisted_activity_kind" NOT NULL,
    "payee_id" UUID,
    "amount_minor" INTEGER,
    "outcome" "suggestion_outcome" NOT NULL DEFAULT 'SHOWN',
    "shown_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suggestion_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payees_user_id_trust_idx" ON "payees"("user_id", "trust");

-- CreateIndex
CREATE INDEX "demo_payment_history_user_id_payee_id_occurred_at_idx" ON "demo_payment_history"("user_id", "payee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "assisted_activities_user_id_status_occurred_at_idx" ON "assisted_activities"("user_id", "status", "occurred_at");

-- CreateIndex
CREATE INDEX "assisted_activities_user_id_payee_id_occurred_at_idx" ON "assisted_activities"("user_id", "payee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "suggestion_offers_user_id_type_shown_at_idx" ON "suggestion_offers"("user_id", "type", "shown_at");

-- CreateIndex
CREATE INDEX "suggestion_offers_user_id_payee_id_outcome_responded_at_idx" ON "suggestion_offers"("user_id", "payee_id", "outcome", "responded_at");

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_payment_history" ADD CONSTRAINT "demo_payment_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_payment_history" ADD CONSTRAINT "demo_payment_history_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "payees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assisted_activities" ADD CONSTRAINT "assisted_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assisted_activities" ADD CONSTRAINT "assisted_activities_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assisted_activities" ADD CONSTRAINT "assisted_activities_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assisted_activities" ADD CONSTRAINT "assisted_activities_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_offers" ADD CONSTRAINT "suggestion_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_offers" ADD CONSTRAINT "suggestion_offers_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
