-- CreateEnum
CREATE TYPE "demo_payment_status" AS ENUM ('COMPLETED', 'FAILED', 'PENDING');

-- AlterTable
ALTER TABLE "demo_payment_history" ADD COLUMN     "status" "demo_payment_status" NOT NULL DEFAULT 'COMPLETED';
