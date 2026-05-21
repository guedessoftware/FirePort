-- CreateTable
CREATE TABLE "ClientAccessControl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active_normal',
    "financialState" TEXT NOT NULL DEFAULT 'active_normal',
    "administrativeBlockActive" BOOLEAN NOT NULL DEFAULT false,
    "administrativeBlockReason" TEXT,
    "administrativeBlockDetails" TEXT,
    "confidenceReleaseUntil" DATETIME,
    "confidenceReleaseGrantedAt" DATETIME,
    "confidenceReleaseGrantedByUserId" TEXT,
    "overdueDays" INTEGER NOT NULL DEFAULT 0,
    "lastEvaluatedAt" DATETIME,
    "pendingAction" TEXT,
    "pendingError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientAccessControl_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientAccessControl_confidenceReleaseGrantedByUserId_fkey" FOREIGN KEY ("confidenceReleaseGrantedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccessControlAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT NOT NULL,
    "userId" TEXT,
    "origin" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousState" TEXT,
    "nextState" TEXT,
    "contractId" TEXT,
    "provisioningId" TEXT,
    "onuReference" TEXT,
    "ruleApplied" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessControlAudit_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessControlAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccessControlNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingAccountId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "AccessControlNotification_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccessControl_billingAccountId_key" ON "ClientAccessControl"("billingAccountId");
CREATE INDEX "ClientAccessControl_billingAccountId_idx" ON "ClientAccessControl"("billingAccountId");
CREATE INDEX "ClientAccessControl_state_idx" ON "ClientAccessControl"("state");
CREATE INDEX "ClientAccessControl_financialState_idx" ON "ClientAccessControl"("financialState");
CREATE INDEX "ClientAccessControl_administrativeBlockActive_idx" ON "ClientAccessControl"("administrativeBlockActive");
CREATE INDEX "ClientAccessControl_pendingAction_idx" ON "ClientAccessControl"("pendingAction");
CREATE INDEX "AccessControlAudit_billingAccountId_idx" ON "AccessControlAudit"("billingAccountId");
CREATE INDEX "AccessControlAudit_userId_idx" ON "AccessControlAudit"("userId");
CREATE INDEX "AccessControlAudit_origin_idx" ON "AccessControlAudit"("origin");
CREATE INDEX "AccessControlAudit_action_idx" ON "AccessControlAudit"("action");
CREATE INDEX "AccessControlAudit_result_idx" ON "AccessControlAudit"("result");
CREATE INDEX "AccessControlAudit_createdAt_idx" ON "AccessControlAudit"("createdAt");
CREATE INDEX "AccessControlNotification_billingAccountId_idx" ON "AccessControlNotification"("billingAccountId");
CREATE INDEX "AccessControlNotification_stage_idx" ON "AccessControlNotification"("stage");
CREATE INDEX "AccessControlNotification_status_idx" ON "AccessControlNotification"("status");
CREATE INDEX "AccessControlNotification_createdAt_idx" ON "AccessControlNotification"("createdAt");
