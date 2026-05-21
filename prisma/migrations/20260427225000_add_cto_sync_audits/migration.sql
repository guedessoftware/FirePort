-- Add audit trail for CTOs that require manual review after Hubsoft sync.
ALTER TABLE "CTO" ADD COLUMN "hubsoftDeletedAt" DATETIME;

CREATE TABLE "CtoSyncAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ctoId" TEXT,
  "hubsoftId" TEXT,
  "ctoName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "provisioningCount" INTEGER NOT NULL DEFAULT 0,
  "portCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CtoSyncAudit_ctoId_fkey" FOREIGN KEY ("ctoId") REFERENCES "CTO" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CtoSyncAudit_ctoId_idx" ON "CtoSyncAudit"("ctoId");
CREATE INDEX "CtoSyncAudit_hubsoftId_idx" ON "CtoSyncAudit"("hubsoftId");
CREATE INDEX "CtoSyncAudit_action_idx" ON "CtoSyncAudit"("action");
