import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  sqlitePragmasReady: Promise<void> | undefined
}

const prismaOptions = process.env.DATABASE_URL
  ? { datasourceUrl: process.env.DATABASE_URL }
  : undefined

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaOptions)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export function ensureSqlitePragmas() {
  if (!process.env.DATABASE_URL?.startsWith('file:')) {
    return Promise.resolve()
  }

  globalForPrisma.sqlitePragmasReady ??= (async () => {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000')
  })().catch((error) => {
    globalForPrisma.sqlitePragmasReady = undefined
    console.error('[PRISMA] falha ao configurar SQLite', error)
  })

  return globalForPrisma.sqlitePragmasReady
}

void ensureSqlitePragmas()
