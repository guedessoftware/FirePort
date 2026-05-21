CREATE TABLE "OltInterface" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "oltDeviceId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GPON',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "chassi" INTEGER NOT NULL,
  "slot" INTEGER NOT NULL,
  "pon" INTEGER NOT NULL,
  "vlan" INTEGER,
  "routingInterface" TEXT,
  "defaultCpeProfileId" TEXT,
  "requireCtoLink" BOOLEAN NOT NULL DEFAULT false,
  "blockOverutilization" BOOLEAN NOT NULL DEFAULT false,
  "enableScan" BOOLEAN NOT NULL DEFAULT true,
  "scanType" TEXT,
  "alarmSubscriberSignal" INTEGER,
  "alarmEquipmentSignal" INTEGER,
  "sequencePort" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OltInterface_oltDeviceId_fkey" FOREIGN KEY ("oltDeviceId") REFERENCES "OltDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OltInterface_oltDeviceId_type_chassi_slot_pon_key" ON "OltInterface"("oltDeviceId", "type", "chassi", "slot", "pon");
CREATE INDEX "OltInterface_oltDeviceId_idx" ON "OltInterface"("oltDeviceId");
CREATE INDEX "OltInterface_type_idx" ON "OltInterface"("type");
CREATE INDEX "OltInterface_isActive_idx" ON "OltInterface"("isActive");
