import { prisma } from './prisma'

let authSecuritySchemaReady: Promise<void> | null = null

async function ensureUserColumn(existingColumns: Set<string>, name: string, statement: string) {
  if (!existingColumns.has(name)) {
    await prisma.$executeRawUnsafe(statement)
  }
}

export async function ensureAuthSecuritySchema() {
  authSecuritySchemaReady ??= (async () => {
    const columns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("User")`
    const columnNames = new Set(columns.map((column) => column.name))

    await ensureUserColumn(columnNames, 'mfaSecretEncrypted', 'ALTER TABLE "User" ADD COLUMN "mfaSecretEncrypted" TEXT')
    await ensureUserColumn(columnNames, 'mfaEnabledAt', 'ALTER TABLE "User" ADD COLUMN "mfaEnabledAt" DATETIME')
    await ensureUserColumn(columnNames, 'mfaPendingSecretEncrypted', 'ALTER TABLE "User" ADD COLUMN "mfaPendingSecretEncrypted" TEXT')
    await ensureUserColumn(columnNames, 'mfaPendingAt', 'ALTER TABLE "User" ADD COLUMN "mfaPendingAt" DATETIME')
    await ensureUserColumn(columnNames, 'passwordResetTokenHash', 'ALTER TABLE "User" ADD COLUMN "passwordResetTokenHash" TEXT')
    await ensureUserColumn(columnNames, 'passwordResetExpiresAt', 'ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" DATETIME')
    await ensureUserColumn(columnNames, 'passwordResetUsedAt', 'ALTER TABLE "User" ADD COLUMN "passwordResetUsedAt" DATETIME')
  })().catch((error) => {
    authSecuritySchemaReady = null
    throw error
  })

  return authSecuritySchemaReady
}
