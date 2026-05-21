ALTER TABLE "User" ADD COLUMN "vlan" INTEGER;

CREATE TABLE "OltProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "driver" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "authorizationCommands" TEXT,
  "provisioningCommands" TEXT,
  "deprovisioningCommands" TEXT,
  "deauthorizationCommands" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "OltProfile_driver_idx" ON "OltProfile"("driver");
CREATE INDEX "OltProfile_isDefault_idx" ON "OltProfile"("isDefault");
