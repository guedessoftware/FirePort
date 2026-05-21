ALTER TABLE "OltDevice" ADD COLUMN "snmpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OltDevice" ADD COLUMN "snmpVersion" TEXT NOT NULL DEFAULT '2c';
ALTER TABLE "OltDevice" ADD COLUMN "snmpCommunityEncrypted" TEXT;
ALTER TABLE "OltDevice" ADD COLUMN "snmpPort" INTEGER NOT NULL DEFAULT 161;
ALTER TABLE "OltDevice" ADD COLUMN "snmpVendor" TEXT NOT NULL DEFAULT 'zte_titan';

CREATE INDEX "OltDevice_snmpEnabled_idx" ON "OltDevice"("snmpEnabled");
CREATE INDEX "OltDevice_snmpVendor_idx" ON "OltDevice"("snmpVendor");

CREATE TABLE "OnuCurrent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "porta" TEXT NOT NULL,
  "ponIndex" BIGINT NOT NULL,
  "onuId" INTEGER NOT NULL,
  "statusCode" INTEGER,
  "statusName" TEXT,
  "rxDbm" REAL,
  "txDbm" REAL,
  "lastOnline" DATETIME,
  "lastOffline" DATETIME,
  "learnedMac" TEXT,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnuCurrent_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OnuCurrent_oltId_ponIndex_onuId_key" ON "OnuCurrent"("oltId", "ponIndex", "onuId");
CREATE INDEX "OnuCurrent_oltId_idx" ON "OnuCurrent"("oltId");
CREATE INDEX "OnuCurrent_porta_idx" ON "OnuCurrent"("porta");
CREATE INDEX "OnuCurrent_statusName_idx" ON "OnuCurrent"("statusName");
CREATE INDEX "OnuCurrent_rxDbm_idx" ON "OnuCurrent"("rxDbm");
CREATE INDEX "OnuCurrent_collectedAt_idx" ON "OnuCurrent"("collectedAt");

CREATE TABLE "OnuHistory" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "porta" TEXT NOT NULL,
  "ponIndex" BIGINT NOT NULL,
  "onuId" INTEGER NOT NULL,
  "statusCode" INTEGER,
  "statusName" TEXT,
  "rxDbm" REAL,
  "txDbm" REAL,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnuHistory_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OnuHistory_oltId_ponIndex_onuId_idx" ON "OnuHistory"("oltId", "ponIndex", "onuId");
CREATE INDEX "OnuHistory_statusName_idx" ON "OnuHistory"("statusName");
CREATE INDEX "OnuHistory_collectedAt_idx" ON "OnuHistory"("collectedAt");

CREATE TABLE "OperatorOnuAccess" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "userId" TEXT NOT NULL,
  "oltId" TEXT NOT NULL,
  "ponIndex" BIGINT NOT NULL,
  "onuId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorOnuAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OperatorOnuAccess_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OperatorOnuAccess_userId_oltId_ponIndex_onuId_key" ON "OperatorOnuAccess"("userId", "oltId", "ponIndex", "onuId");
CREATE INDEX "OperatorOnuAccess_userId_idx" ON "OperatorOnuAccess"("userId");
CREATE INDEX "OperatorOnuAccess_oltId_ponIndex_onuId_idx" ON "OperatorOnuAccess"("oltId", "ponIndex", "onuId");

CREATE TABLE "OnuEvent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "ponIndex" BIGINT NOT NULL,
  "onuId" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "previousValue" TEXT,
  "currentValue" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnuEvent_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OnuEvent_oltId_ponIndex_onuId_idx" ON "OnuEvent"("oltId", "ponIndex", "onuId");
CREATE INDEX "OnuEvent_eventType_idx" ON "OnuEvent"("eventType");
CREATE INDEX "OnuEvent_createdAt_idx" ON "OnuEvent"("createdAt");
