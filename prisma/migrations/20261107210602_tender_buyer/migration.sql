-- AlterTable
ALTER TABLE "Tender" ADD COLUMN     "buyerId" TEXT;

-- CreateIndex
CREATE INDEX "Tender_buyerId_idx" ON "Tender"("buyerId");
