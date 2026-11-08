-- CreateTable
CREATE TABLE "ChannelLink" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "address" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelLinkCode" (
    "codeHash" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelLinkCode_pkey" PRIMARY KEY ("codeHash")
);

-- CreateTable
CREATE TABLE "ChannelMessage" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "clarificationId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelLink_sellerId_kind_key" ON "ChannelLink"("sellerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelLink_kind_address_key" ON "ChannelLink"("kind", "address");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelLinkCode_sellerId_kind_key" ON "ChannelLinkCode"("sellerId", "kind");

-- CreateIndex
CREATE INDEX "ChannelMessage_linkId_sentAt_idx" ON "ChannelMessage"("linkId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessage_linkId_externalId_key" ON "ChannelMessage"("linkId", "externalId");

-- AddForeignKey
ALTER TABLE "ChannelLink" ADD CONSTRAINT "ChannelLink_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelLinkCode" ADD CONSTRAINT "ChannelLinkCode_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_clarificationId_fkey" FOREIGN KEY ("clarificationId") REFERENCES "Clarification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;
