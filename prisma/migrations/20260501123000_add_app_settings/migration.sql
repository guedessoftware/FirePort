CREATE TABLE "AppSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");
CREATE INDEX "AppSetting_key_idx" ON "AppSetting"("key");
