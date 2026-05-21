ALTER TABLE "AccessControlNotification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AccessControlNotification" ADD COLUMN "lastAttemptAt" DATETIME;
ALTER TABLE "AccessControlNotification" ADD COLUMN "lastError" TEXT;
