ALTER TABLE "OltDevice" ADD COLUMN "useEnableMode" BOOLEAN NOT NULL DEFAULT false;

UPDATE "OltDevice"
SET "useEnableMode" = true
WHERE "enablePasswordEncrypted" IS NOT NULL
  AND "enablePasswordEncrypted" <> '';
