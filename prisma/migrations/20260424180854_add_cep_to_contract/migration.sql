/*
  Warnings:

  - Added the required column `cep` to the `Contract` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "landlordId" TEXT NOT NULL,
    CONSTRAINT "Contract_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Contract" ("address", "contractNumber", "id", "landlordId", "lat", "lng", "name") SELECT "address", "contractNumber", "id", "landlordId", "lat", "lng", "name" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
