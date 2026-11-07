-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Tender" ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]';
