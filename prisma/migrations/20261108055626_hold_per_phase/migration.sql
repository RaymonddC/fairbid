-- DropIndex
DROP INDEX "Authorization_awardId_key";

-- AlterTable
ALTER TABLE "Authorization" ADD COLUMN     "phase" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Award" ADD COLUMN     "endedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "dueDay" INTEGER,
ADD COLUMN     "phase" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_awardId_seq_key" ON "Authorization"("awardId", "seq");

