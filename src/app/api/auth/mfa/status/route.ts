import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../[...nextauth]/route'
import { ensureAuthSecuritySchema } from '@/lib/auth-schema'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const userId = (session?.user as { id?: string } | undefined)?.id
    if (!userId) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    await ensureAuthSecuritySchema()
    const rows = await prisma.$queryRaw<Array<{ role: string; mfaEnabledAt: string | Date | null }>>`
      SELECT "role", "mfaEnabledAt"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
    `
    const user = rows[0]
    if (!user) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    return NextResponse.json({
      required: user.role === 'admin',
      enabled: Boolean(user.mfaEnabledAt),
      verified: (session?.user as { mfaVerified?: boolean } | undefined)?.mfaVerified === true,
    })
  } catch (error) {
    console.error('[MFA STATUS] erro ao consultar MFA', error)
    return NextResponse.json({ error: 'Erro ao consultar MFA.' }, { status: 500 })
  }
}
