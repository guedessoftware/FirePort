import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureAuthSecuritySchema } from '@/lib/auth-schema'
import { generateSecureToken, hashSecurityToken, isValidEmail, normalizeEmail } from '@/lib/auth-security'
import { sendPasswordResetEmail } from '@/lib/notifications'

const RESET_TTL_MS = 30 * 60 * 1000

function resetUrl(request: NextRequest, token: string) {
  const configuredUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL
  const origin = configuredUrl || new URL(request.url).origin
  return `${origin.replace(/\/$/, '')}/senha/redefinir?token=${encodeURIComponent(token)}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = normalizeEmail(typeof body.email === 'string' ? body.email : '')

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ ok: true })
    }

    await ensureAuthSecuritySchema()
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    })

    if (!user) {
      return NextResponse.json({ ok: true })
    }

    const token = generateSecureToken()
    const tokenHash = hashSecurityToken(token)
    const expiresAt = new Date(Date.now() + RESET_TTL_MS)
    await prisma.$executeRaw`
      UPDATE "User"
      SET
        "passwordResetTokenHash" = ${tokenHash},
        "passwordResetExpiresAt" = ${expiresAt},
        "passwordResetUsedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${user.id}
    `

    const url = resetUrl(request, token)
    try {
      await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl: url })
    } catch (error) {
      console.error('[PASSWORD RESET] falha ao enviar email', error)
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({ ok: true, debugResetUrl: url })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[PASSWORD RESET] erro ao solicitar reset', error)
    return NextResponse.json({ ok: true })
  }
}
