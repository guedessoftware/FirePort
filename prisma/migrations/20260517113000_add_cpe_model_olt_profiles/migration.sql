CREATE TABLE "CpeModelOltProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cpeModelId" TEXT NOT NULL,
  "oltManufacturer" TEXT NOT NULL,
  "oltModel" TEXT NOT NULL,
  "oltDriver" TEXT NOT NULL,
  "onuType" TEXT,
  "authorizationCommands" TEXT,
  "provisioningCommands" TEXT,
  "deprovisioningCommands" TEXT,
  "deauthorizationCommands" TEXT,
  "tr069Commands" TEXT,
  "genieAcsParameterMapJson" TEXT,
  "requiredVariablesJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CpeModelOltProfile_cpeModelId_fkey" FOREIGN KEY ("cpeModelId") REFERENCES "CPEModel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CpeModelOltProfile_cpeModelId_oltManufacturer_oltModel_oltDriver_key"
ON "CpeModelOltProfile"("cpeModelId", "oltManufacturer", "oltModel", "oltDriver");

CREATE INDEX "CpeModelOltProfile_cpeModelId_idx" ON "CpeModelOltProfile"("cpeModelId");
CREATE INDEX "CpeModelOltProfile_oltManufacturer_oltModel_oltDriver_idx"
ON "CpeModelOltProfile"("oltManufacturer", "oltModel", "oltDriver");

INSERT INTO "CpeModelOltProfile" (
  "id",
  "cpeModelId",
  "oltManufacturer",
  "oltModel",
  "oltDriver",
  "onuType",
  "authorizationCommands",
  "provisioningCommands",
  "deprovisioningCommands",
  "deauthorizationCommands",
  "tr069Commands",
  "genieAcsParameterMapJson",
  "requiredVariablesJson",
  "createdAt",
  "updatedAt"
)
SELECT
  lower(hex(randomblob(16))),
  "CPEModel"."id",
  "OltTargets"."manufacturer",
  "OltTargets"."model",
  "OltTargets"."driver",
  COALESCE(
    json_extract("CPEModel"."scripts", '$.oltProfile.onuType'),
    json_extract("CPEModel"."scripts", '$.ont'),
    "CPEModel"."name"
  ),
  COALESCE(
    (
      SELECT "ProvisioningProfile"."authorizationCommands"
      FROM "ProvisioningProfile"
      WHERE "ProvisioningProfile"."driver" = "OltTargets"."driver"
        AND "ProvisioningProfile"."authorizationCommands" IS NOT NULL
      ORDER BY "ProvisioningProfile"."isDefault" DESC, "ProvisioningProfile"."updatedAt" DESC
      LIMIT 1
    ),
    (
      SELECT "OltProfile"."authorizationCommands"
      FROM "OltProfile"
      WHERE "OltProfile"."driver" = "OltTargets"."driver"
        AND "OltProfile"."authorizationCommands" IS NOT NULL
      ORDER BY "OltProfile"."isDefault" DESC, "OltProfile"."updatedAt" DESC
      LIMIT 1
    )
  ),
  COALESCE(
    (
      SELECT "ProvisioningProfile"."provisioningCommands"
      FROM "ProvisioningProfile"
      WHERE "ProvisioningProfile"."driver" = "OltTargets"."driver"
        AND "ProvisioningProfile"."provisioningCommands" IS NOT NULL
      ORDER BY "ProvisioningProfile"."isDefault" DESC, "ProvisioningProfile"."updatedAt" DESC
      LIMIT 1
    ),
    (
      SELECT "OltProfile"."provisioningCommands"
      FROM "OltProfile"
      WHERE "OltProfile"."driver" = "OltTargets"."driver"
        AND "OltProfile"."provisioningCommands" IS NOT NULL
      ORDER BY "OltProfile"."isDefault" DESC, "OltProfile"."updatedAt" DESC
      LIMIT 1
    )
  ),
  COALESCE(
    (
      SELECT "ProvisioningProfile"."deprovisioningCommands"
      FROM "ProvisioningProfile"
      WHERE "ProvisioningProfile"."driver" = "OltTargets"."driver"
        AND "ProvisioningProfile"."deprovisioningCommands" IS NOT NULL
      ORDER BY "ProvisioningProfile"."isDefault" DESC, "ProvisioningProfile"."updatedAt" DESC
      LIMIT 1
    ),
    (
      SELECT "OltProfile"."deprovisioningCommands"
      FROM "OltProfile"
      WHERE "OltProfile"."driver" = "OltTargets"."driver"
        AND "OltProfile"."deprovisioningCommands" IS NOT NULL
      ORDER BY "OltProfile"."isDefault" DESC, "OltProfile"."updatedAt" DESC
      LIMIT 1
    )
  ),
  COALESCE(
    (
      SELECT "ProvisioningProfile"."deauthorizationCommands"
      FROM "ProvisioningProfile"
      WHERE "ProvisioningProfile"."driver" = "OltTargets"."driver"
        AND "ProvisioningProfile"."deauthorizationCommands" IS NOT NULL
      ORDER BY "ProvisioningProfile"."isDefault" DESC, "ProvisioningProfile"."updatedAt" DESC
      LIMIT 1
    ),
    (
      SELECT "OltProfile"."deauthorizationCommands"
      FROM "OltProfile"
      WHERE "OltProfile"."driver" = "OltTargets"."driver"
        AND "OltProfile"."deauthorizationCommands" IS NOT NULL
      ORDER BY "OltProfile"."isDefault" DESC, "OltProfile"."updatedAt" DESC
      LIMIT 1
    )
  ),
  NULL,
  json_object(
    'serialParameter', 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_GPONSN',
    'wifiSsidParameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
    'wifiPasswordParameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
    'wifi5SsidParameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
    'wifi5PasswordParameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase',
    'hostsObjectPath', 'InternetGatewayDevice.LANDevice.1.Hosts.Host',
    'wifi24AssociatedDevicePath', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice',
    'wifi5AssociatedDevicePath', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice'
  ),
  json_array('vlan', 'chassi', 'slot', 'pon', 'indice_onu', 'phy_addr', 'onu_type'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CPEModel"
CROSS JOIN (
  SELECT DISTINCT
    COALESCE(NULLIF(trim("manufacturer"), ''), 'ZTE') AS "manufacturer",
    COALESCE(NULLIF(trim("model"), ''), 'C650') AS "model",
    COALESCE(NULLIF(trim("driver"), ''), 'zte-c650') AS "driver"
  FROM "OltDevice"
  UNION
  SELECT 'ZTE' AS "manufacturer", 'C650' AS "model", 'zte-c650' AS "driver"
) AS "OltTargets";
