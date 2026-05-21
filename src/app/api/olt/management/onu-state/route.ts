import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getOltDeviceConnectionById } from '@/lib/olt-devices'
import { queryOltOnuState } from '@/lib/olt-management'

type OltInterfaceRow = {
  id: string
  oltDeviceId: string
  type: string
  name: string
  chassi: number
  slot: number
  pon: number
}

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return authError(auth.error ?? 'Apenas administradores podem executar comandos de gestão da OLT.', auth.status)
    }

    const body = await request.json()
    const interfaceId = text(body.interfaceId)
    if (!interfaceId) {
      return NextResponse.json({ error: 'Interface da OLT é obrigatória.' }, { status: 400 })
    }

    const interfaces = await prisma.$queryRaw<OltInterfaceRow[]>`
      SELECT id, oltDeviceId, type, name, chassi, slot, pon
      FROM OltInterface
      WHERE id = ${interfaceId}
      LIMIT 1
    `
    const oltInterface = interfaces[0]
    if (!oltInterface) {
      return NextResponse.json({ error: 'Interface da OLT não encontrada.' }, { status: 404 })
    }

    const device = await getOltDeviceConnectionById(oltInterface.oltDeviceId)
    if (!device || !device.isActive) {
      return NextResponse.json({ error: 'OLT inativa ou não encontrada.' }, { status: 404 })
    }

    const result = await queryOltOnuState(device, oltInterface)

    return NextResponse.json({
      command: result.command,
      output: result.output,
      stderr: result.stderr,
      interface: oltInterface,
      positions: result.positions,
    })
  } catch (error) {
    console.error('OLT ONU state command error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao consultar ONUs na OLT.' }, { status: 500 })
  }
}
