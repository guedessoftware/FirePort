CREATE TABLE "ProvisioningLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provisioningId" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'info',
  "stage" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProvisioningLog_provisioningId_fkey" FOREIGN KEY ("provisioningId") REFERENCES "Provisioning" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProvisioningLog_provisioningId_idx" ON "ProvisioningLog"("provisioningId");
CREATE INDEX "ProvisioningLog_level_idx" ON "ProvisioningLog"("level");
CREATE INDEX "ProvisioningLog_createdAt_idx" ON "ProvisioningLog"("createdAt");
