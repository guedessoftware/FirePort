ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsReserved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsLinked" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsAvailable" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CTO" ADD COLUMN "hubsoftLastOccupationSync" DATETIME;

ALTER TABLE "Port" ADD COLUMN "hubsoftId" TEXT;
ALTER TABLE "Port" ADD COLUMN "hubsoftReserved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Port" ADD COLUMN "hubsoftReference" TEXT;
ALTER TABLE "Port" ADD COLUMN "hubsoftHasClientService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Port" ADD COLUMN "hubsoftRawStatus" TEXT;
ALTER TABLE "Port" ADD COLUMN "hubsoftLastSync" DATETIME;

CREATE UNIQUE INDEX "Port_hubsoftId_key" ON "Port"("hubsoftId");
CREATE INDEX "Port_hubsoftId_idx" ON "Port"("hubsoftId");
CREATE INDEX "Port_hubsoftRawStatus_idx" ON "Port"("hubsoftRawStatus");
CREATE INDEX "Port_hubsoftLastSync_idx" ON "Port"("hubsoftLastSync");
