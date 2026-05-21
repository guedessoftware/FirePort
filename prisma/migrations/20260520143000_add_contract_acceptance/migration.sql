-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetRole" TEXT NOT NULL DEFAULT 'landlord',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activeVersionId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContractTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "pdfHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "publishedAt" DATETIME,
    "publishedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContractVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractAcceptance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "landlordId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "signatureMethod" TEXT NOT NULL DEFAULT 'otp',
    "otpChallengeId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "contractHash" TEXT NOT NULL,
    "pdfHash" TEXT,
    "previousEvidenceHash" TEXT,
    "acceptanceHash" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractAcceptance_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractAcceptance_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractAcceptanceOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "destination" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractAcceptanceOtp_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractAcceptanceOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContractTemplate_isActive_idx" ON "ContractTemplate"("isActive");
CREATE INDEX "ContractTemplate_targetRole_idx" ON "ContractTemplate"("targetRole");
CREATE INDEX "ContractTemplate_activeVersionId_idx" ON "ContractTemplate"("activeVersionId");
CREATE INDEX "ContractVersion_templateId_idx" ON "ContractVersion"("templateId");
CREATE INDEX "ContractVersion_status_idx" ON "ContractVersion"("status");
CREATE INDEX "ContractVersion_contentHash_idx" ON "ContractVersion"("contentHash");
CREATE UNIQUE INDEX "ContractVersion_templateId_versionNumber_key" ON "ContractVersion"("templateId", "versionNumber");
CREATE INDEX "ContractAcceptance_versionId_idx" ON "ContractAcceptance"("versionId");
CREATE INDEX "ContractAcceptance_userId_idx" ON "ContractAcceptance"("userId");
CREATE INDEX "ContractAcceptance_landlordId_idx" ON "ContractAcceptance"("landlordId");
CREATE INDEX "ContractAcceptance_status_idx" ON "ContractAcceptance"("status");
CREATE INDEX "ContractAcceptance_acceptedAt_idx" ON "ContractAcceptance"("acceptedAt");
CREATE INDEX "ContractAcceptanceOtp_versionId_idx" ON "ContractAcceptanceOtp"("versionId");
CREATE INDEX "ContractAcceptanceOtp_userId_idx" ON "ContractAcceptanceOtp"("userId");
CREATE INDEX "ContractAcceptanceOtp_status_idx" ON "ContractAcceptanceOtp"("status");
CREATE INDEX "ContractAcceptanceOtp_expiresAt_idx" ON "ContractAcceptanceOtp"("expiresAt");
