-- Removes the Area concept.
--
-- Branch alone is now the whole of the scanned context: a QR code
-- carries { "branch_id": "BR001" } and nothing else.
--
-- Destructive by design. The areas table and sessions.area_id are
-- dropped, not archived -- keeping an orphaned table would leave the
-- schema claiming a relationship the application no longer has.

-- DropForeignKey
ALTER TABLE "areas" DROP CONSTRAINT "areas_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_area_id_fkey";

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "area_id";

-- DropTable
DROP TABLE "areas";
