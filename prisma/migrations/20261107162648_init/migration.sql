-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'REVIEWING', 'CLARIFYING', 'PRICED', 'SCORED', 'AWARDED', 'IN_DELIVERY', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidLineKind" AS ENUM ('goods', 'shipping', 'duty', 'vat', 'fees');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('inapp', 'whatsapp', 'telegram');

-- CreateEnum
CREATE TYPE "FlagKind" AS ENUM ('price_and_text');

-- CreateEnum
CREATE TYPE "FlagReview" AS ENUM ('unreviewed', 'confirmed', 'dismissed');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('pending', 'confirmed', 'captured');

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "needText" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "budgetCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "destinationCountry" TEXT NOT NULL,
    "vatReclaimable" BOOLEAN NOT NULL DEFAULT true,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "TenderStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightPct" INTEGER NOT NULL,
    "rubric" TEXT NOT NULL,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "paypalEmail" TEXT NOT NULL,
    "channelKind" "ChannelKind" NOT NULL DEFAULT 'inapp',
    "channelAddress" TEXT,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "hsCode" TEXT,
    "hsConfidence" DECIMAL(3,2),
    "leadTimeDays" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,
    "sealedHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidLine" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "kind" "BidLineKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "BidLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clarification" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "sentTo" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" TEXT NOT NULL,
    "clarificationId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "channel" "ChannelKind" NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "pairedBidId" TEXT NOT NULL,
    "kind" "FlagKind" NOT NULL,
    "similarity" DECIMAL(4,3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewStatus" "FlagReview" NOT NULL DEFAULT 'unreviewed',

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "holdCents" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Authorization" (
    "id" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "paypalOrderId" TEXT NOT NULL,
    "paypalAuthId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,

    CONSTRAINT "Authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "paypalCaptureId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "finalCapture" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pct" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffRate" (
    "id" TEXT NOT NULL,
    "hsPrefix" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "dutyPct" DECIMAL(5,2) NOT NULL,
    "vatPct" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "TariffRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Criterion_tenderId_idx" ON "Criterion"("tenderId");

-- CreateIndex
CREATE INDEX "Bid_tenderId_idx" ON "Bid"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_tenderId_sellerId_key" ON "Bid"("tenderId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "BidLine_bidId_kind_key" ON "BidLine"("bidId", "kind");

-- CreateIndex
CREATE INDEX "Clarification_tenderId_idx" ON "Clarification"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "Reply_clarificationId_bidId_key" ON "Reply"("clarificationId", "bidId");

-- CreateIndex
CREATE UNIQUE INDEX "Score_bidId_criterionId_key" ON "Score"("bidId", "criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_bidId_pairedBidId_key" ON "Flag"("bidId", "pairedBidId");

-- CreateIndex
CREATE UNIQUE INDEX "Award_tenderId_key" ON "Award"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_awardId_key" ON "Authorization"("awardId");

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_paypalOrderId_key" ON "Authorization"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_paypalAuthId_key" ON "Authorization"("paypalAuthId");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_milestoneId_key" ON "Capture"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_paypalCaptureId_key" ON "Capture"("paypalCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_awardId_seq_key" ON "Milestone"("awardId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Event_tenderId_seq_key" ON "Event"("tenderId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "TariffRate_hsPrefix_destination_effectiveFrom_key" ON "TariffRate"("hsPrefix", "destination", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidLine" ADD CONSTRAINT "BidLine_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_clarificationId_fkey" FOREIGN KEY ("clarificationId") REFERENCES "Clarification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_pairedBidId_fkey" FOREIGN KEY ("pairedBidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Authorization" ADD CONSTRAINT "Authorization_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Award"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "Authorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Award"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
