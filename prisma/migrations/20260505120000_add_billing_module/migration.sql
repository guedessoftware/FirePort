-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultMinimumAmountCents" INTEGER NOT NULL DEFAULT 0,
    "defaultIncludedProvisionings" INTEGER NOT NULL DEFAULT 0,
    "defaultExtraProvisioningAmountCents" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "landlordId" TEXT NOT NULL,
    "hubsoftClientServiceId" TEXT,
    "hubsoftServiceName" TEXT NOT NULL DEFAULT 'Servico de Rede Neutra',
    "billingPlanId" TEXT,
    "minimumAmountCents" INTEGER NOT NULL DEFAULT 0,
    "includedProvisionings" INTEGER NOT NULL DEFAULT 0,
    "extraProvisioningAmountCents" INTEGER NOT NULL DEFAULT 0,
    "dueDay" INTEGER NOT NULL DEFAULT 10,
    "firstActivationAt" DATETIME,
    "billingStartedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingAccount_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingAccount_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT NOT NULL,
    "provisioningId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "ctoId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "activatedAt" DATETIME NOT NULL,
    "canceledAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "billingPlanId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingService_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingService_provisioningId_fkey" FOREIGN KEY ("provisioningId") REFERENCES "Provisioning" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingService_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingService_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingService_ctoId_fkey" FOREIGN KEY ("ctoId") REFERENCES "CTO" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingService_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "competence" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "closingAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BillingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingCycleId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "hubsoftClientServiceId" TEXT,
    "dueDay" INTEGER NOT NULL,
    "activeProvisioningCount" INTEGER NOT NULL DEFAULT 0,
    "includedProvisioningCount" INTEGER NOT NULL DEFAULT 0,
    "extraProvisioningCount" INTEGER NOT NULL DEFAULT 0,
    "minimumAmountCents" INTEGER NOT NULL DEFAULT 0,
    "extraAmountCents" INTEGER NOT NULL DEFAULT 0,
    "penaltyAmountCents" INTEGER NOT NULL DEFAULT 0,
    "totalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "idempotencyKey" TEXT NOT NULL,
    "calculatedAt" DATETIME,
    "sentAt" DATETIME,
    "reconciledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingRun_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingRun_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingRunItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingRunId" TEXT NOT NULL,
    "billingServiceId" TEXT,
    "provisioningId" TEXT,
    "contractId" TEXT,
    "ctoId" TEXT,
    "portId" TEXT,
    "serial" TEXT,
    "itemType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "isIncludedInMinimum" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" DATETIME,
    "canceledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingRunItem_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingRunItem_billingServiceId_fkey" FOREIGN KEY ("billingServiceId") REFERENCES "BillingService" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingRunItem_provisioningId_fkey" FOREIGN KEY ("provisioningId") REFERENCES "Provisioning" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingRunItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingRunItem_ctoId_fkey" FOREIGN KEY ("ctoId") REFERENCES "CTO" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingRunItem_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingPenalty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" DATETIME,
    "includedInBillingRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingPenalty_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingPenalty_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingPenalty_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingPenalty_includedInBillingRunId_fkey" FOREIGN KEY ("includedInBillingRunId") REFERENCES "BillingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HubsoftBillingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingRunId" TEXT NOT NULL,
    "hubsoftClientServiceId" TEXT NOT NULL,
    "hubsoftEventType" TEXT NOT NULL DEFAULT 'Servico de Rede Neutra',
    "idempotencyKey" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HubsoftBillingEvent_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT,
    "provisioningId" TEXT,
    "billingRunId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "message" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedByUserId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingAlert_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingAlert_provisioningId_fkey" FOREIGN KEY ("provisioningId") REFERENCES "Provisioning" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingAlert_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingAlert_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HubsoftInvoiceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT NOT NULL,
    "billingRunId" TEXT,
    "hubsoftInvoiceId" TEXT,
    "hubsoftClientServiceId" TEXT NOT NULL,
    "competence" TEXT,
    "dueDate" DATETIME,
    "amountCents" INTEGER,
    "status" TEXT,
    "rawPayload" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HubsoftInvoiceSnapshot_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HubsoftInvoiceSnapshot_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BillingPlan_isDefault_idx" ON "BillingPlan"("isDefault");
CREATE INDEX "BillingPlan_isActive_idx" ON "BillingPlan"("isActive");
CREATE UNIQUE INDEX "BillingAccount_landlordId_key" ON "BillingAccount"("landlordId");
CREATE INDEX "BillingAccount_hubsoftClientServiceId_idx" ON "BillingAccount"("hubsoftClientServiceId");
CREATE INDEX "BillingAccount_billingPlanId_idx" ON "BillingAccount"("billingPlanId");
CREATE INDEX "BillingAccount_status_idx" ON "BillingAccount"("status");
CREATE UNIQUE INDEX "BillingService_provisioningId_key" ON "BillingService"("provisioningId");
CREATE INDEX "BillingService_billingAccountId_idx" ON "BillingService"("billingAccountId");
CREATE INDEX "BillingService_contractId_idx" ON "BillingService"("contractId");
CREATE INDEX "BillingService_portId_idx" ON "BillingService"("portId");
CREATE INDEX "BillingService_ctoId_idx" ON "BillingService"("ctoId");
CREATE INDEX "BillingService_status_idx" ON "BillingService"("status");
CREATE INDEX "BillingService_activatedAt_idx" ON "BillingService"("activatedAt");
CREATE INDEX "BillingService_canceledAt_idx" ON "BillingService"("canceledAt");
CREATE INDEX "BillingCycle_closingAt_idx" ON "BillingCycle"("closingAt");
CREATE INDEX "BillingCycle_status_idx" ON "BillingCycle"("status");
CREATE UNIQUE INDEX "BillingCycle_competence_key" ON "BillingCycle"("competence");
CREATE UNIQUE INDEX "BillingCycle_year_month_key" ON "BillingCycle"("year", "month");
CREATE UNIQUE INDEX "BillingRun_idempotencyKey_key" ON "BillingRun"("idempotencyKey");
CREATE INDEX "BillingRun_billingCycleId_idx" ON "BillingRun"("billingCycleId");
CREATE INDEX "BillingRun_billingAccountId_idx" ON "BillingRun"("billingAccountId");
CREATE INDEX "BillingRun_competence_idx" ON "BillingRun"("competence");
CREATE INDEX "BillingRun_status_idx" ON "BillingRun"("status");
CREATE UNIQUE INDEX "BillingRun_billingAccountId_competence_key" ON "BillingRun"("billingAccountId", "competence");
CREATE INDEX "BillingRunItem_billingRunId_idx" ON "BillingRunItem"("billingRunId");
CREATE INDEX "BillingRunItem_billingServiceId_idx" ON "BillingRunItem"("billingServiceId");
CREATE INDEX "BillingRunItem_provisioningId_idx" ON "BillingRunItem"("provisioningId");
CREATE INDEX "BillingRunItem_itemType_idx" ON "BillingRunItem"("itemType");
CREATE INDEX "BillingPenalty_billingAccountId_idx" ON "BillingPenalty"("billingAccountId");
CREATE INDEX "BillingPenalty_status_idx" ON "BillingPenalty"("status");
CREATE INDEX "BillingPenalty_includedInBillingRunId_idx" ON "BillingPenalty"("includedInBillingRunId");
CREATE INDEX "BillingPenalty_createdByUserId_idx" ON "BillingPenalty"("createdByUserId");
CREATE INDEX "BillingPenalty_approvedByUserId_idx" ON "BillingPenalty"("approvedByUserId");
CREATE UNIQUE INDEX "HubsoftBillingEvent_billingRunId_key" ON "HubsoftBillingEvent"("billingRunId");
CREATE UNIQUE INDEX "HubsoftBillingEvent_idempotencyKey_key" ON "HubsoftBillingEvent"("idempotencyKey");
CREATE INDEX "HubsoftBillingEvent_hubsoftClientServiceId_idx" ON "HubsoftBillingEvent"("hubsoftClientServiceId");
CREATE INDEX "HubsoftBillingEvent_status_idx" ON "HubsoftBillingEvent"("status");
CREATE INDEX "BillingAlert_billingAccountId_idx" ON "BillingAlert"("billingAccountId");
CREATE INDEX "BillingAlert_provisioningId_idx" ON "BillingAlert"("provisioningId");
CREATE INDEX "BillingAlert_billingRunId_idx" ON "BillingAlert"("billingRunId");
CREATE INDEX "BillingAlert_type_idx" ON "BillingAlert"("type");
CREATE INDEX "BillingAlert_severity_idx" ON "BillingAlert"("severity");
CREATE INDEX "BillingAlert_status_idx" ON "BillingAlert"("status");
CREATE INDEX "HubsoftInvoiceSnapshot_billingAccountId_idx" ON "HubsoftInvoiceSnapshot"("billingAccountId");
CREATE INDEX "HubsoftInvoiceSnapshot_billingRunId_idx" ON "HubsoftInvoiceSnapshot"("billingRunId");
CREATE INDEX "HubsoftInvoiceSnapshot_hubsoftInvoiceId_idx" ON "HubsoftInvoiceSnapshot"("hubsoftInvoiceId");
CREATE INDEX "HubsoftInvoiceSnapshot_hubsoftClientServiceId_idx" ON "HubsoftInvoiceSnapshot"("hubsoftClientServiceId");
CREATE INDEX "HubsoftInvoiceSnapshot_competence_idx" ON "HubsoftInvoiceSnapshot"("competence");
CREATE INDEX "HubsoftInvoiceSnapshot_status_idx" ON "HubsoftInvoiceSnapshot"("status");
