-- CreateTable
CREATE TABLE "Watcher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" REAL NOT NULL,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    "pnl" REAL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "watcherId" TEXT NOT NULL,
    CONSTRAINT "Trade_watcherId_fkey" FOREIGN KEY ("watcherId") REFERENCES "Watcher" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "txHash" TEXT,
    "stage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watcherId" TEXT,
    CONSTRAINT "Event_watcherId_fkey" FOREIGN KEY ("watcherId") REFERENCES "Watcher" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Watcher_address_chain_idx" ON "Watcher"("address", "chain");

-- CreateIndex
CREATE INDEX "Trade_watcherId_idx" ON "Trade"("watcherId");

-- CreateIndex
CREATE INDEX "Trade_address_idx" ON "Trade"("address");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "Trade_address_token_idx" ON "Trade"("address", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_txHash_address_key" ON "Trade"("txHash", "address");

-- CreateIndex
CREATE INDEX "Event_watcherId_idx" ON "Event"("watcherId");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");
