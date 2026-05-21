/*
  Warnings:

  - A unique constraint covering the columns `[hubsoftId]` on the table `CTO` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CTO" ADD COLUMN "hubsoftId" TEXT;
ALTER TABLE "CTO" ADD COLUMN "lastSync" DATETIME;
ALTER TABLE "CTO" ADD COLUMN "syncError" TEXT;
ALTER TABLE "CTO" ADD COLUMN "syncStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CTO_hubsoftId_key" ON "CTO"("hubsoftId");

-- CreateIndex
CREATE INDEX "CTO_lat_lng_idx" ON "CTO"("lat", "lng");

-- CreateIndex
CREATE INDEX "CTO_hubsoftId_idx" ON "CTO"("hubsoftId");
