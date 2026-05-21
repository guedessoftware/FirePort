import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { listOnuHistory } from '@/lib/onu-snmp'
import { prisma } from '@/lib/prisma'

async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  return prisma.user.findUnique({ where: { id: userId } })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    const { id } = await context.params
    const result = await listOnuHistory({
      currentId: id,
      userId: currentUser.id,
      role: currentUser.role,
    })

    if (!result) {
      return NextResponse.json({ error: 'ONU nao encontrada ou sem permissao.' }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[ONU HISTORY] erro ao listar historico', error)
    return NextResponse.json({ error: 'Erro ao listar historico da ONU.' }, { status: 500 })
  }
}
