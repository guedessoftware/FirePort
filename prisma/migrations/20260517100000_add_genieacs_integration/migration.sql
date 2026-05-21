ALTER TABLE "Provisioning" ADD COLUMN "genieAcsDeviceId" TEXT;
ALTER TABLE "Provisioning" ADD COLUMN "genieAcsSerialParameter" TEXT;
ALTER TABLE "Provisioning" ADD COLUMN "genieAcsLinkedAt" DATETIME;
ALTER TABLE "Provisioning" ADD COLUMN "genieAcsLastInformAt" DATETIME;
ALTER TABLE "Provisioning" ADD COLUMN "genieAcsLastSyncAt" DATETIME;
ALTER TABLE "Provisioning" ADD COLUMN "genieAcsSummaryJson" TEXT;

CREATE INDEX "Provisioning_genieAcsDeviceId_idx" ON "Provisioning"("genieAcsDeviceId");
CREATE INDEX "Provisioning_genieAcsLastInformAt_idx" ON "Provisioning"("genieAcsLastInformAt");
