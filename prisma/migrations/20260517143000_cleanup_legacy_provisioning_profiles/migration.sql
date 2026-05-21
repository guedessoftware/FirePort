ALTER TABLE "CPEModel" DROP COLUMN "scripts";

ALTER TABLE "ProvisioningProfile" DROP COLUMN "onuType";
ALTER TABLE "ProvisioningProfile" DROP COLUMN "authorizationCommands";
ALTER TABLE "ProvisioningProfile" DROP COLUMN "provisioningCommands";
ALTER TABLE "ProvisioningProfile" DROP COLUMN "deprovisioningCommands";
ALTER TABLE "ProvisioningProfile" DROP COLUMN "deauthorizationCommands";

DROP TABLE IF EXISTS "OltProfile";
