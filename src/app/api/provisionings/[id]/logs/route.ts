import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { parseProvisioningLogDetails } from '@/lib/provisioning-logs'
import { authOptions } from '../../../auth/[...nextauth]/route'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessão inválida ou expirada. Faça login novamente.',
  }, { status: 401 })
}

export async function GET(_request: NextRequest, context: RouteContext<'/api/provisionings/[id]/logs'>) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return unauthorized()
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    return unauthorized()
  }

  const { id } = await context.params
  const provisioning = await prisma.provisioning.findFirst({
    where: user.role === 'admin'
      ? { id }
      : { id, contract: { landlord: { userId: user.id } } },
    select: { id: true },
  })

  if (!provisioning) {
    return NextResponse.json({ error: 'Provisionamento não encontrado para este usuário.' }, { status: 404 })
  }

  const logs = await prisma.$queryRaw<Array<{
    id: string
    provisioningId: string
    level: string
    stage: string
    message: string
    details: string | null
    createdAt: Date | string
  }>>`
    SELECT id, provisioningId, level, stage, message, details, createdAt
    FROM ProvisioningLog
    WHERE provisioningId = ${id}
    ORDER BY createdAt ASC
  `

  return NextResponse.json(logs.map((log) => ({
    ...log,
    details: parseProvisioningLogDetails(log.details),
  })))
}
