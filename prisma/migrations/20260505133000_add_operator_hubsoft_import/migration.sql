-- AlterTable
ALTER TABLE "Landlord" ADD COLUMN "document" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftClientId" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftClientUuid" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftClientCode" INTEGER;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftLegalName" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftTradeName" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftPersonType" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftPrimaryPhone" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftSecondaryPhone" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftPrimaryEmail" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftOrigin" TEXT;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftImportedAt" DATETIME;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftUpdatedAt" DATETIME;
ALTER TABLE "Landlord" ADD COLUMN "hubsoftRawJson" TEXT;

-- CreateIndex
CREATE INDEX "Landlord_document_idx" ON "Landlord"("document");
CREATE INDEX "Landlord_hubsoftClientId_idx" ON "Landlord"("hubsoftClientId");
