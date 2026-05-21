ALTER TABLE "CTO" ADD COLUMN "hubsoftOltDeviceId" TEXT;
ALTER TABLE "CTO" ADD COLUMN "hubsoftOltInterfaceId" TEXT;
ALTER TABLE "CTO" ADD COLUMN "oltDeviceName" TEXT;
ALTER TABLE "CTO" ADD COLUMN "oltIpv4" TEXT;
ALTER TABLE "CTO" ADD COLUMN "oltInterfaceName" TEXT;
ALTER TABLE "CTO" ADD COLUMN "oltInterfaceType" TEXT;
ALTER TABLE "CTO" ADD COLUMN "oltInterfaceIdentifier" TEXT;
ALTER TABLE "CTO" ADD COLUMN "oltChassi" INTEGER;
ALTER TABLE "CTO" ADD COLUMN "oltSlot" INTEGER;
ALTER TABLE "CTO" ADD COLUMN "oltPon" INTEGER;
ALTER TABLE "CTO" ADD COLUMN "oltVlan" INTEGER;
ALTER TABLE "CTO" ADD COLUMN "oltInterfaceId" TEXT REFERENCES "OltInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OltDevice" ADD COLUMN "hubsoftId" TEXT;
ALTER TABLE "OltInterface" ADD COLUMN "hubsoftId" TEXT;

CREATE UNIQUE INDEX "OltDevice_hubsoftId_key" ON "OltDevice"("hubsoftId");
CREATE UNIQUE INDEX "OltInterface_hubsoftId_key" ON "OltInterface"("hubsoftId");
CREATE INDEX "CTO_hubsoftOltDeviceId_idx" ON "CTO"("hubsoftOltDeviceId");
CREATE INDEX "CTO_hubsoftOltInterfaceId_idx" ON "CTO"("hubsoftOltInterfaceId");
CREATE INDEX "CTO_oltInterfaceId_idx" ON "CTO"("oltInterfaceId");
CREATE INDEX "OltDevice_hubsoftId_idx" ON "OltDevice"("hubsoftId");
CREATE INDEX "OltInterface_hubsoftId_idx" ON "OltInterface"("hubsoftId");
