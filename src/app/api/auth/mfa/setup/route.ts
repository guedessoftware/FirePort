import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../[...nextauth]/route'
import { ensureAuthSecuritySchema } from '@/lib/auth-schema'
import {
  buildTotpUri,
  decryptAuthSecret,
  encryptAuthSecret,
  generateTotpSecret,
  verifyTotpCode,
} from '@/lib/auth-security'

async function currentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return null

  await ensureAuthSecuritySchema()
  const rows = await prisma.$queryRaw<Array<{
    id: string
    email: string
    role: string
    mfaEnabledAt: string | Date | null
    mfaPendingSecretEncrypted: string | null
  }>>`
    SELECT "id", "email", "role", "mfaEnabledAt", "mfaPendingSecretEncrypted"
    FROM "User"
    WHERE "id" = ${userId}
    LIMIT 1
  `

  return rows[0] ?? null
}

export async function GET() {
  try {
    const user = await currentUser()
    if (!user) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'MFA obrigatorio apenas para administradores.' }, { status: 403 })
    }
    if (user.mfaEnabledAt) {
      return NextResponse.json({ enabled: true })
    }

    let shouldStorePendingSecret = false
    const secret = (() => {
      if (!user.mfaPendingSecretEncrypted) {
        shouldStorePendingSecret = true
        return generateTotpSecret()
      }
      try {
        return decryptAuthSecret(user.mfaPendingSecretEncrypted)
      } catch {
        shouldStorePendingSecret = true
        return generateTotpSecret()
      }
    })()
    const encryptedSecret = encryptAuthSecret(secret)
    if (shouldStorePendingSecret) {
      await prisma.$executeRaw`
        UPDATE "User"
        SET
          "mfaPendingSecretEncrypted" = ${encryptedSecret},
          "mfaPendingAt" = ${new Date()},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${user.id}
      `
    }

    return NextResponse.json({
      enabled: false,
      secret,
      otpauthUrl: buildTotpUri({ secret, accountName: user.email }),
    })
  } catch (error) {
    console.error('[MFA SETUP] erro ao iniciar MFA', error)
    return NextResponse.json({ error: 'Erro ao iniciar MFA.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser()
    if (!user) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'MFA obrigatorio apenas para administradores.' }, { status: 403 })
    }
    if (user.mfaEnabledAt) {
      return NextResponse.json({ ok: true, enabled: true })
    }
    if (!user.mfaPendingSecretEncrypted) {
      return NextResponse.json({ error: 'Inicie a configuracao do MFA antes de confirmar.' }, { status: 400 })
    }

    const body = await request.json()
    const code = typeof body.code === 'string' ? body.code : ''
    const secret = decryptAuthSecret(user.mfaPendingSecretEncrypted)
    if (!verifyTotpCode(secret, code)) {
      return NextResponse.json({ error: 'Codigo MFA invalido.' }, { status: 400 })
    }

    await prisma.$executeRaw`
      UPDATE "User"
      SET
        "mfaSecretEncrypted" = ${user.mfaPendingSecretEncrypted},
        "mfaEnabledAt" = ${new Date()},
        "mfaPendingSecretEncrypted" = NULL,
        "mfaPendingAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${user.id}
    `

    return NextResponse.json({ ok: true, enabled: true })
  } catch (error) {
    console.error('[MFA SETUP] erro ao confirmar MFA', error)
    return NextResponse.json({ error: 'Erro ao confirmar MFA.' }, { status: 500 })
  }
}
