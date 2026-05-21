CREATE TABLE "OltHealthCurrent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "temperatureC" INTEGER,
  "processorCount" INTEGER NOT NULL DEFAULT 0,
  "maxCpu5sPercent" INTEGER,
  "maxCpu1mPercent" INTEGER,
  "maxCpu5mPercent" INTEGER,
  "maxMemUsedPercent" INTEGER,
  "sensorWarningCount" INTEGER NOT NULL DEFAULT 0,
  "sensorCriticalCount" INTEGER NOT NULL DEFAULT 0,
  "uplinkCount" INTEGER NOT NULL DEFAULT 0,
  "uplinkDownCount" INTEGER NOT NULL DEFAULT 0,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OltHealthCurrent_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OltHealthCurrent_oltId_key" ON "OltHealthCurrent"("oltId");
CREATE INDEX "OltHealthCurrent_oltId_idx" ON "OltHealthCurrent"("oltId");
CREATE INDEX "OltHealthCurrent_collectedAt_idx" ON "OltHealthCurrent"("collectedAt");

CREATE TABLE "OltHealthHistory" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "temperatureC" INTEGER,
  "processorCount" INTEGER NOT NULL DEFAULT 0,
  "maxCpu5sPercent" INTEGER,
  "maxCpu1mPercent" INTEGER,
  "maxCpu5mPercent" INTEGER,
  "maxMemUsedPercent" INTEGER,
  "sensorWarningCount" INTEGER NOT NULL DEFAULT 0,
  "sensorCriticalCount" INTEGER NOT NULL DEFAULT 0,
  "uplinkCount" INTEGER NOT NULL DEFAULT 0,
  "uplinkDownCount" INTEGER NOT NULL DEFAULT 0,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OltHealthHistory_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OltHealthHistory_oltId_idx" ON "OltHealthHistory"("oltId");
CREATE INDEX "OltHealthHistory_collectedAt_idx" ON "OltHealthHistory"("collectedAt");

CREATE TABLE "OltProcessorCurrent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "processorIndex" TEXT NOT NULL,
  "character" TEXT NOT NULL,
  "role" TEXT,
  "cpu5sPercent" INTEGER,
  "cpu1mPercent" INTEGER,
  "cpu5mPercent" INTEGER,
  "peakCpuPercent" INTEGER,
  "physicalMemMb" INTEGER,
  "freeMemMb" INTEGER,
  "memUsedPercent" INTEGER,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OltProcessorCurrent_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OltProcessorCurrent_oltId_processorIndex_key" ON "OltProcessorCurrent"("oltId", "processorIndex");
CREATE INDEX "OltProcessorCurrent_oltId_idx" ON "OltProcessorCurrent"("oltId");
CREATE INDEX "OltProcessorCurrent_cpu5sPercent_idx" ON "OltProcessorCurrent"("cpu5sPercent");
CREATE INDEX "OltProcessorCurrent_memUsedPercent_idx" ON "OltProcessorCurrent"("memUsedPercent");
CREATE INDEX "OltProcessorCurrent_collectedAt_idx" ON "OltProcessorCurrent"("collectedAt");

CREATE TABLE "OltTemperatureCurrent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "sensorIndex" TEXT NOT NULL,
  "board" TEXT,
  "sensor" TEXT,
  "statusCode" INTEGER,
  "statusName" TEXT,
  "temperatureC" INTEGER,
  "threshold1C" INTEGER,
  "threshold2C" INTEGER,
  "threshold3C" INTEGER,
  "threshold4C" INTEGER,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OltTemperatureCurrent_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OltTemperatureCurrent_oltId_sensorIndex_key" ON "OltTemperatureCurrent"("oltId", "sensorIndex");
CREATE INDEX "OltTemperatureCurrent_oltId_idx" ON "OltTemperatureCurrent"("oltId");
CREATE INDEX "OltTemperatureCurrent_statusName_idx" ON "OltTemperatureCurrent"("statusName");
CREATE INDEX "OltTemperatureCurrent_temperatureC_idx" ON "OltTemperatureCurrent"("temperatureC");
CREATE INDEX "OltTemperatureCurrent_collectedAt_idx" ON "OltTemperatureCurrent"("collectedAt");

CREATE TABLE "OltUplinkCurrent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "oltId" TEXT NOT NULL,
  "ifIndex" INTEGER NOT NULL,
  "interfaceName" TEXT NOT NULL,
  "operStatus" TEXT NOT NULL,
  "rxMbps" REAL,
  "txMbps" REAL,
  "observation" TEXT,
  "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OltUplinkCurrent_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OltUplinkCurrent_oltId_ifIndex_key" ON "OltUplinkCurrent"("oltId", "ifIndex");
CREATE INDEX "OltUplinkCurrent_oltId_idx" ON "OltUplinkCurrent"("oltId");
CREATE INDEX "OltUplinkCurrent_operStatus_idx" ON "OltUplinkCurrent"("operStatus");
CREATE INDEX "OltUplinkCurrent_collectedAt_idx" ON "OltUplinkCurrent"("collectedAt");
