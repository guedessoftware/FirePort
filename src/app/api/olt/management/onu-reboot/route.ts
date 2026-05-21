import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { getOltDeviceConnectionById } from '@/lib/olt-devices'
import { rebootOltOnu } from '@/lib/olt-management'
import { ensureOperatorOnuAccessFromProvisionings, ponIndexToPort } from '@/lib/onu-snmp'
import { prisma } from '@/lib/prisma'

type OnuTargetRow = {
  id: string
  oltId: string
  porta: string
  ponIndex: number | bigint
  onuId: number
}

async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  return prisma.user.findUnique({ where: { id: userId } })
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parsePort(port: string) {
  const [chassi, slot, pon] = port.split('/').map(Number)

  if (!Number.isInteger(chassi) || !Number.isInteger(slot) || !Number.isInteger(pon) || chassi < 1 || slot < 1 || pon < 1) {
    return null
  }

  return { chassi, slot, pon }
}

function forbidden() {
  return NextResponse.json({ error: 'Voce nao tem permissao para reiniciar esta ONU.' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    const body = await request.json()
    const onuCurrentId = text(body.onuCurrentId || body.id)
    if (!onuCurrentId) {
      return NextResponse.json({ error: 'ONU é obrigatória.' }, { status: 400 })
    }

    if (currentUser.role !== 'admin') {
      await ensureOperatorOnuAccessFromProvisionings(currentUser.id)
    }

    const targets = currentUser.role === 'admin'
      ? await prisma.$queryRaw<OnuTargetRow[]>`
          SELECT "id", "oltId", "porta", "ponIndex", "onuId"
          FROM "OnuCurrent"
          WHERE "id" = ${onuCurrentId}
          LIMIT 1
        `
      : await prisma.$queryRaw<OnuTargetRow[]>`
          SELECT "OnuCurrent"."id", "OnuCurrent"."oltId", "OnuCurrent"."porta", "OnuCurrent"."ponIndex", "OnuCurrent"."onuId"
          FROM "OnuCurrent"
          INNER JOIN "OperatorOnuAccess"
            ON "OperatorOnuAccess"."oltId" = "OnuCurrent"."oltId"
            AND "OperatorOnuAccess"."ponIndex" = "OnuCurrent"."ponIndex"
            AND "OperatorOnuAccess"."onuId" = "OnuCurrent"."onuId"
          WHERE "OnuCurrent"."id" = ${onuCurrentId}
            AND "OperatorOnuAccess"."userId" = ${currentUser.id}
          LIMIT 1
        `
    const target = targets[0]
    if (!target) {
      return forbidden()
    }

    const device = await getOltDeviceConnectionById(target.oltId)
    if (!device || !device.isActive) {
      return NextResponse.json({ error: 'OLT inativa ou não encontrada.' }, { status: 404 })
    }

    const fallbackPort = ponIndexToPort(Number(target.ponIndex))
    const port = parsePort(target.porta) ?? parsePort(fallbackPort)
    if (!port) {
      return NextResponse.json({ error: 'Porta da ONU inválida para reboot.' }, { status: 400 })
    }

    const result = await rebootOltOnu(device, {
      ...port,
      onuId: target.onuId,
    })

    return NextResponse.json({
      ok: true,
      message: 'ONU reiniciada com sucesso.',
      commands: result.commands,
      output: result.output,
      stderr: result.stderr,
    })
  } catch (error) {
    console.error('[API OLT ONU REBOOT] erro ao reiniciar ONU', error)
    return NextResponse.json({
      error: 'Erro ao reiniciar ONU.',
    }, { status: 500 })
  }
}
