-- DropIndex
DROP INDEX "TariffRate_hsPrefix_destination_effectiveFrom_key";

-- AlterTable
ALTER TABLE "TariffRate" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "TariffRate_hsPrefix_destination_origin_effectiveFrom_key" ON "TariffRate"("hsPrefix", "destination", "origin", "effectiveFrom");

