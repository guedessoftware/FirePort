import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureAuthSecuritySchema } from '@/lib/auth-schema'
import { getPasswordPolicyError, hashPassword, hashSecurityToken } from '@/lib/auth-security'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!token || !password) {
      return NextResponse.json({ error: 'Token e nova senha sao obrigatorios.' }, { status: 400 })
    }

    await ensureAuthSecuritySchema()
    const tokenHash = hashSecurityToken(token)
    const rows = await prisma.$queryRaw<Array<{
      id: string
      email: string
      passwordResetExpiresAt: string | Date | null
      passwordResetUsedAt: string | Date | null
    }>>`
      SELECT "id", "email", "passwordResetExpiresAt", "passwordResetUsedAt"
      FROM "User"
      WHERE "passwordResetTokenHash" = ${tokenHash}
      LIMIT 1
    `
    const user = rows[0]
    const expiresAt = user?.passwordResetExpiresAt ? new Date(user.passwordResetExpiresAt) : null
    if (!user || user.passwordResetUsedAt || !expiresAt || expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Token invalido ou expirado.' }, { status: 400 })
    }

    const passwordPolicyError = getPasswordPolicyError(password, user.email)
    if (passwordPolicyError) {
      return NextResponse.json({ error: passwordPolicyError }, { status: 400 })
    }

    await prisma.$executeRaw`
      UPDATE "User"
      SET
        "password" = ${await hashPassword(password)},
        "passwordResetUsedAt" = ${new Date()},
        "passwordResetTokenHash" = NULL,
        "passwordResetExpiresAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${user.id}
    `

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[PASSWORD RESET] erro ao confirmar reset', error)
    return NextResponse.json({ error: 'Erro ao redefinir senha.' }, { status: 500 })
  }
}
