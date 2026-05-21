import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { bulkCreateOltInterfaces, listOltInterfaces, upsertOltInterface } from '@/lib/olt-interfaces'

async function getCurrentAdmin() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user?.role === 'admin' ? user : null
}

function forbidden() {
  return NextResponse.json({ error: 'Apenas administradores podem gerenciar interfaces de OLT.' }, { status: 403 })
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  const clean = text(value)
  return clean || null
}

function numberValue(value: unknown, fallback?: number) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseInterfaceInput(body: Record<string, unknown>) {
  return {
    id: optionalText(body.id) ?? undefined,
    oltDeviceId: text(body.oltDeviceId),
    type: text(body.type) || 'GPON',
    name: text(body.name),
    description: optionalText(body.description),
    chassi: numberValue(body.chassi),
    slot: numberValue(body.slot),
    pon: numberValue(body.pon),
    vlan: numberValue(body.vlan, undefined) ?? null,
    routingInterface: optionalText(body.routingInterface),
    defaultCpeProfileId: optionalText(body.defaultCpeProfileId),
    requireCtoLink: Boolean(body.requireCtoLink),
    blockOverutilization: Boolean(body.blockOverutilization),
    enableScan: body.enableScan === undefined ? true : Boolean(body.enableScan),
    scanType: optionalText(body.scanType),
    alarmSubscriberSignal: numberValue(body.alarmSubscriberSignal, undefined) ?? null,
    alarmEquipmentSignal: numberValue(body.alarmEquipmentSignal, undefined) ?? null,
    sequencePort: numberValue(body.sequencePort, undefined) ?? null,
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
  }
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const oltDeviceId = request.nextUrl.searchParams.get('oltDeviceId') || undefined
    return NextResponse.json(await listOltInterfaces(oltDeviceId))
  } catch (error) {
    console.error('OLT interface list error:', error)
    return NextResponse.json({ error: 'Erro ao listar interfaces da OLT.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    if (body.mode === 'bulk') {
      const oltDeviceId = text(body.oltDeviceId)
      const type = text(body.type) || 'GPON'
      const chassiStart = numberValue(body.chassiStart)
      const chassiEnd = numberValue(body.chassiEnd)
      const slotStart = numberValue(body.slotStart)
      const slotEnd = numberValue(body.slotEnd)
      const ponStart = numberValue(body.ponStart)
      const ponEnd = numberValue(body.ponEnd)

      if (!oltDeviceId || chassiStart === undefined || chassiEnd === undefined || slotStart === undefined || slotEnd === undefined || ponStart === undefined || ponEnd === undefined) {
        return NextResponse.json({ error: 'Equipamento, chassi, slot e PON sao obrigatorios para cadastro em massa.' }, { status: 400 })
      }

      const interfaces = await bulkCreateOltInterfaces({
        oltDeviceId,
        type,
        namePrefix: optionalText(body.namePrefix) ?? undefined,
        chassiStart,
        chassiEnd,
        slotStart,
        slotEnd,
        ponStart,
        ponEnd,
        vlanStart: numberValue(body.vlanStart, undefined) ?? null,
        vlanIncrement: numberValue(body.vlanIncrement, 0),
        routingInterface: optionalText(body.routingInterface),
        defaultCpeProfileId: optionalText(body.defaultCpeProfileId),
        requireCtoLink: Boolean(body.requireCtoLink),
        blockOverutilization: Boolean(body.blockOverutilization),
        enableScan: body.enableScan === undefined ? true : Boolean(body.enableScan),
        scanType: optionalText(body.scanType),
        alarmSubscriberSignal: numberValue(body.alarmSubscriberSignal, undefined) ?? null,
        alarmEquipmentSignal: numberValue(body.alarmEquipmentSignal, undefined) ?? null,
      })

      return NextResponse.json({ interfaces }, { status: 201 })
    }

    const input = parseInterfaceInput(body)
    if (!input.oltDeviceId || !input.name || input.chassi === undefined || input.slot === undefined || input.pon === undefined) {
      return NextResponse.json({ error: 'Equipamento, nome, chassi, slot e PON sao obrigatorios.' }, { status: 400 })
    }

    const item = await upsertOltInterface({
      ...input,
      chassi: input.chassi,
      slot: input.slot,
      pon: input.pon,
    })

    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    console.error('OLT interface create error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao criar interface da OLT.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    const input = parseInterfaceInput(body)
    if (!input.id || !input.oltDeviceId || !input.name || input.chassi === undefined || input.slot === undefined || input.pon === undefined) {
      return NextResponse.json({ error: 'ID, equipamento, nome, chassi, slot e PON sao obrigatorios.' }, { status: 400 })
    }

    const item = await upsertOltInterface({
      ...input,
      id: input.id,
      chassi: input.chassi,
      slot: input.slot,
      pon: input.pon,
    })

    return NextResponse.json(item)
  } catch (error) {
    console.error('OLT interface update error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao atualizar interface da OLT.' }, { status: 500 })
  }
}
