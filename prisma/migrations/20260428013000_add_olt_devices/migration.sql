CREATE TABLE "OltDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "pop" TEXT,
  "managementServer" TEXT,
  "host" TEXT NOT NULL,
  "ipv4" TEXT,
  "ipv6" TEXT,
  "username" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 22,
  "passwordEncrypted" TEXT NOT NULL,
  "enablePasswordEncrypted" TEXT,
  "driver" TEXT NOT NULL,
  "profileId" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "OltDevice_driver_idx" ON "OltDevice"("driver");
CREATE INDEX "OltDevice_profileId_idx" ON "OltDevice"("profileId");
CREATE INDEX "OltDevice_isDefault_idx" ON "OltDevice"("isDefault");
CREATE INDEX "OltDevice_isActive_idx" ON "OltDevice"("isActive");
