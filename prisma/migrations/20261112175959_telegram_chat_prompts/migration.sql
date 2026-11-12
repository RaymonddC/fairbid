-- CreateTable
CREATE TABLE "ChatPrompt" (
    "id" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "address" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatPrompt_kind_address_externalId_key" ON "ChatPrompt"("kind", "address", "externalId");

-- AddForeignKey
ALTER TABLE "ChatPrompt" ADD CONSTRAINT "ChatPrompt_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
