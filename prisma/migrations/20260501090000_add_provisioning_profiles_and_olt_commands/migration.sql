-- Add operational command templates to each OLT. Existing hardcoded ZTE
-- behavior remains available through the defaults used by the application.
ALTER TABLE "OltDevice" ADD COLUMN "terminalLengthCommand" TEXT;
ALTER TABLE "OltDevice" ADD COLUMN "enterConfigCommand" TEXT;
ALTER TABLE "OltDevice" ADD COLUMN "showOnuStateCommand" TEXT;
ALTER TABLE "OltDevice" ADD COLUMN "saveConfigCommand" TEXT;
ALTER TABLE "OltDevice" ADD COLUMN "exitCommands" TEXT;

CREATE TABLE "ProvisioningProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "driver" TEXT NOT NULL,
  "vlan" INTEGER,
  "serviceVlan" INTEGER,
  "lineProfile" TEXT,
  "serviceProfile" TEXT,
  "onuType" TEXT,
  "gemPort" INTEGER,
  "tcont" INTEGER,
  "serviceName" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "authorizationCommands" TEXT,
  "provisioningCommands" TEXT,
  "deprovisioningCommands" TEXT,
  "deauthorizationCommands" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProvisioningProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProvisioningProfile_userId_idx" ON "ProvisioningProfile"("userId");
CREATE INDEX "ProvisioningProfile_driver_idx" ON "ProvisioningProfile"("driver");
CREATE INDEX "ProvisioningProfile_isDefault_idx" ON "ProvisioningProfile"("isDefault");

INSERT INTO "ProvisioningProfile" (
  "id",
  "userId",
  "name",
  "driver",
  "vlan",
  "isDefault",
  "authorizationCommands",
  "provisioningCommands",
  "deprovisioningCommands",
  "deauthorizationCommands",
  "updatedAt"
)
SELECT
  lower(hex(randomblob(16))),
  "User"."id",
  COALESCE("OltProfile"."name", 'Perfil padrao de provisionamento'),
  COALESCE("OltProfile"."driver", 'zte-c650'),
  "User"."vlan",
  true,
  "OltProfile"."authorizationCommands",
  "OltProfile"."provisioningCommands",
  "OltProfile"."deprovisioningCommands",
  "OltProfile"."deauthorizationCommands",
  CURRENT_TIMESTAMP
FROM "User"
LEFT JOIN "OltProfile"
  ON "OltProfile"."id" = (
    SELECT "id"
    FROM "OltProfile"
    ORDER BY "isDefault" DESC, "updatedAt" DESC
    LIMIT 1
  )
WHERE "User"."role" <> 'admin';
