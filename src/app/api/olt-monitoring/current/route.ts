import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { getOltMonitoringSummary, listOltMonitoringCurrent } from '@/lib/olt-snmp-monitoring'
import { prisma } from '@/lib/prisma'

async function getCurrentAdmin() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user?.role === 'admin' ? user : null
}

export async function GET() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return NextResponse.json({ error: 'Apenas administradores podem listar o monitoramento de OLT.' }, { status: 403 })
    }

    const items = await listOltMonitoringCurrent()
    const summary = await getOltMonitoringSummary()

    return NextResponse.json({ summary, items })
  } catch (error) {
    console.error('[OLT CURRENT] erro ao listar OLTs', error)
    return NextResponse.json({ error: 'Erro ao listar monitoramento de OLTs.' }, { status: 500 })
  }
}
