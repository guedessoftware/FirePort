import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { getOnuSummary, listOnuCurrent } from '@/lib/onu-snmp'
import { prisma } from '@/lib/prisma'

async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  return prisma.user.findUnique({ where: { id: userId } })
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const rxBelow = searchParams.has('rxBelow') ? Number(searchParams.get('rxBelow')) : null
    const items = await listOnuCurrent({
      userId: currentUser.id,
      role: currentUser.role,
      oltId: searchParams.get('oltId'),
      porta: searchParams.get('porta'),
      status: searchParams.get('status'),
      rxBelow: typeof rxBelow === 'number' && Number.isFinite(rxBelow) ? rxBelow : null,
      search: searchParams.get('search'),
    })
    const summary = await getOnuSummary({ userId: currentUser.id, role: currentUser.role })

    return NextResponse.json({ summary, items })
  } catch (error) {
    console.error('[ONU CURRENT] erro ao listar ONUs', error)
    return NextResponse.json({ error: 'Erro ao listar monitoramento de ONUs.' }, { status: 500 })
  }
}
