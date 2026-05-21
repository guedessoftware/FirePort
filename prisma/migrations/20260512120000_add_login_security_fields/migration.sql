ALTER TABLE "User" ADD COLUMN "mfaSecretEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaEnabledAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "mfaPendingSecretEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaPendingAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "passwordResetUsedAt" DATETIME;

CREATE INDEX "User_passwordResetTokenHash_idx" ON "User"("passwordResetTokenHash");
