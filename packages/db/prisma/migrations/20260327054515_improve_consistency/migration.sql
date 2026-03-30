-- 创建表
CREATE TABLE "Watcher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 创建表
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

-- 创建表
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

-- 创建索引
CREATE INDEX "Watcher_address_chain_idx" ON "Watcher"("address", "chain");

-- 创建索引
CREATE INDEX "Trade_watcherId_idx" ON "Trade"("watcherId");

-- 创建索引
CREATE INDEX "Trade_address_idx" ON "Trade"("address");

-- 创建索引
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- 创建索引
CREATE INDEX "Trade_address_token_idx" ON "Trade"("address", "token");

-- 创建索引
CREATE UNIQUE INDEX "Trade_txHash_address_key" ON "Trade"("txHash", "address");

-- 创建索引
CREATE INDEX "Event_watcherId_idx" ON "Event"("watcherId");

-- 创建索引
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");
