-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "agentBrief" TEXT,
ADD COLUMN     "agentOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agentUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TenderQuestion" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answeredBy" TEXT,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "TenderQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerChannelLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "address" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerChannelLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLinkCode" (
    "codeHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerLinkCode_pkey" PRIMARY KEY ("codeHash")
);

-- CreateTable
CREATE TABLE "BuyerChannelMessage" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "tenderQuestionId" TEXT,
    "externalId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerChannelMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenderQuestion_tenderId_idx" ON "TenderQuestion"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerChannelLink_accountId_kind_key" ON "BuyerChannelLink"("accountId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerChannelLink_kind_address_key" ON "BuyerChannelLink"("kind", "address");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLinkCode_accountId_kind_key" ON "BuyerLinkCode"("accountId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerChannelMessage_linkId_externalId_key" ON "BuyerChannelMessage"("linkId", "externalId");

-- AddForeignKey
ALTER TABLE "TenderQuestion" ADD CONSTRAINT "TenderQuestion_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderQuestion" ADD CONSTRAINT "TenderQuestion_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerChannelLink" ADD CONSTRAINT "BuyerChannelLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLinkCode" ADD CONSTRAINT "BuyerLinkCode_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerChannelMessage" ADD CONSTRAINT "BuyerChannelMessage_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "BuyerChannelLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerChannelMessage" ADD CONSTRAINT "BuyerChannelMessage_tenderQuestionId_fkey" FOREIGN KEY ("tenderQuestionId") REFERENCES "TenderQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
