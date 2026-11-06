-- QR Management: remember which Super Admin created a placement. Additive only — existing placements keep their
-- ids, area slugs and status (createdById stays NULL for them).
-- AlterTable
ALTER TABLE "InstitutionQrCode" ADD COLUMN "createdById" UUID;

-- AddForeignKey
ALTER TABLE "InstitutionQrCode" ADD CONSTRAINT "InstitutionQrCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StudentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
