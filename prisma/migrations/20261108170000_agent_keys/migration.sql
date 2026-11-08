-- CreateTable
CREATE TABLE "AgentKey" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AgentKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentKey_keyHash_key" ON "AgentKey"("keyHash");

-- CreateIndex
CREATE INDEX "AgentKey_sellerId_idx" ON "AgentKey"("sellerId");

-- AddForeignKey
ALTER TABLE "AgentKey" ADD CONSTRAINT "AgentKey_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

