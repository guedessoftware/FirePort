-- CreateTable
CREATE TABLE "OperatorErpConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "landlordId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedLookupKeys" TEXT NOT NULL DEFAULT '["cpf_cnpj","customer_id","contract_id"]',
    "tokenEncrypted" TEXT,
    "usernameEncrypted" TEXT,
    "passwordEncrypted" TEXT,
    "clientIdEncrypted" TEXT,
    "clientSecretEncrypted" TEXT,
    "extraJson" TEXT,
    "lastConnectionStatus" TEXT,
    "lastConnectionTestAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OperatorErpConfig_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErpLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "landlordId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "customerExternalId" TEXT,
    "customerDisplayCode" TEXT,
    "customerUrl" TEXT,
    "serviceExternalId" TEXT,
    "contractExternalId" TEXT,
    "serviceDisplayCode" TEXT,
    "serviceUrl" TEXT,
    "planName" TEXT,
    "login" TEXT,
    "document" TEXT,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErpLink_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErpLink_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Change contract uniqueness from global contract number to operator-scoped contract number.
DROP INDEX IF EXISTS "Contract_contractNumber_key";
CREATE UNIQUE INDEX "Contract_landlordId_contractNumber_key" ON "Contract"("landlordId", "contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorErpConfig_landlordId_key" ON "OperatorErpConfig"("landlordId");
CREATE INDEX "OperatorErpConfig_provider_idx" ON "OperatorErpConfig"("provider");
CREATE INDEX "OperatorErpConfig_enabled_idx" ON "OperatorErpConfig"("enabled");
CREATE UNIQUE INDEX "ErpLink_contractId_key" ON "ErpLink"("contractId");
CREATE INDEX "ErpLink_landlordId_idx" ON "ErpLink"("landlordId");
CREATE INDEX "ErpLink_provider_idx" ON "ErpLink"("provider");
CREATE INDEX "ErpLink_customerExternalId_idx" ON "ErpLink"("customerExternalId");
CREATE INDEX "ErpLink_serviceExternalId_idx" ON "ErpLink"("serviceExternalId");
CREATE INDEX "ErpLink_contractExternalId_idx" ON "ErpLink"("contractExternalId");
