-- AlterTable
ALTER TABLE "Capture" ADD COLUMN     "refundedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "statusReason" TEXT;
