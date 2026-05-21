import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { listOltDrivers } from '@/lib/olt'
import { listOltDevices, upsertOltDevice } from '@/lib/olt-devices'

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
  return NextResponse.json({ error: 'Apenas administradores podem gerenciar OLTs.' }, { status: 403 })
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  const clean = text(value)
  return clean || null
}

function validateDriver(driver: string) {
  return listOltDrivers().some((item) => item.id === driver)
}

export async function GET() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    return NextResponse.json(await listOltDevices())
  } catch (error) {
    console.error('OLT device list error:', error)
    return NextResponse.json({ error: 'Erro ao listar OLTs.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    const name = text(body.name)
    const manufacturer = text(body.manufacturer)
    const model = text(body.model)
    const host = text(body.host || body.ipv4)
    const username = text(body.username)
    const driver = text(body.driver)
    const port = Number(body.port || 22)
    const password = text(body.password)
    const snmpPort = Number(body.snmpPort || 161)

    if (!name || !manufacturer || !model || !host || !username || !driver || !password) {
      return NextResponse.json({ error: 'Nome, fabricante, modelo, host, usuário, senha e driver são obrigatórios.' }, { status: 400 })
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: 'Porta SSH inválida.' }, { status: 400 })
    }

    if (!Number.isInteger(snmpPort) || snmpPort < 1 || snmpPort > 65535) {
      return NextResponse.json({ error: 'Porta SNMP inválida.' }, { status: 400 })
    }

    if (!validateDriver(driver)) {
      return NextResponse.json({ error: 'Driver OLT inválido.' }, { status: 400 })
    }

    const device = await upsertOltDevice({
      name,
      manufacturer,
      model,
      pop: optionalText(body.pop),
      managementServer: optionalText(body.managementServer),
      host,
      ipv4: optionalText(body.ipv4 || host),
      ipv6: optionalText(body.ipv6),
      username,
      port,
      password,
      enablePassword: optionalText(body.enablePassword),
      useEnableMode: Boolean(body.useEnableMode),
      driver,
      profileId: optionalText(body.profileId),
      terminalLengthCommand: optionalText(body.terminalLengthCommand),
      enterConfigCommand: optionalText(body.enterConfigCommand),
      showOnuStateCommand: optionalText(body.showOnuStateCommand),
      serialLookupCommand: optionalText(body.serialLookupCommand),
      rebootOnuCommand: optionalText(body.rebootOnuCommand),
      saveConfigCommand: optionalText(body.saveConfigCommand),
      exitCommands: optionalText(body.exitCommands),
      snmpEnabled: Boolean(body.snmpEnabled),
      snmpVersion: text(body.snmpVersion) || '2c',
      snmpCommunity: optionalText(body.snmpCommunity),
      snmpPort,
      snmpVendor: text(body.snmpVendor) || 'zte_titan',
      isDefault: Boolean(body.isDefault),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    })

    return NextResponse.json(device, { status: 201 })
  } catch (error) {
    console.error('OLT device create error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao criar OLT.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    const id = text(body.id)
    const name = text(body.name)
    const manufacturer = text(body.manufacturer)
    const model = text(body.model)
    const host = text(body.host || body.ipv4)
    const username = text(body.username)
    const driver = text(body.driver)
    const port = Number(body.port || 22)
    const snmpPort = Number(body.snmpPort || 161)

    if (!id || !name || !manufacturer || !model || !host || !username || !driver) {
      return NextResponse.json({ error: 'ID, nome, fabricante, modelo, host, usuário e driver são obrigatórios.' }, { status: 400 })
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: 'Porta SSH inválida.' }, { status: 400 })
    }

    if (!Number.isInteger(snmpPort) || snmpPort < 1 || snmpPort > 65535) {
      return NextResponse.json({ error: 'Porta SNMP inválida.' }, { status: 400 })
    }

    if (!validateDriver(driver)) {
      return NextResponse.json({ error: 'Driver OLT inválido.' }, { status: 400 })
    }

    const device = await upsertOltDevice({
      id,
      name,
      manufacturer,
      model,
      pop: optionalText(body.pop),
      managementServer: optionalText(body.managementServer),
      host,
      ipv4: optionalText(body.ipv4 || host),
      ipv6: optionalText(body.ipv6),
      username,
      port,
      password: optionalText(body.password),
      enablePassword: body.enablePassword === undefined ? undefined : optionalText(body.enablePassword),
      useEnableMode: Boolean(body.useEnableMode),
      driver,
      profileId: optionalText(body.profileId),
      terminalLengthCommand: optionalText(body.terminalLengthCommand),
      enterConfigCommand: optionalText(body.enterConfigCommand),
      showOnuStateCommand: optionalText(body.showOnuStateCommand),
      serialLookupCommand: optionalText(body.serialLookupCommand),
      rebootOnuCommand: optionalText(body.rebootOnuCommand),
      saveConfigCommand: optionalText(body.saveConfigCommand),
      exitCommands: optionalText(body.exitCommands),
      snmpEnabled: Boolean(body.snmpEnabled),
      snmpVersion: text(body.snmpVersion) || '2c',
      snmpCommunity: body.snmpCommunity === undefined ? undefined : optionalText(body.snmpCommunity),
      snmpPort,
      snmpVendor: text(body.snmpVendor) || 'zte_titan',
      isDefault: Boolean(body.isDefault),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    })

    return NextResponse.json(device)
  } catch (error) {
    console.error('OLT device update error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao atualizar OLT.' }, { status: 500 })
  }
}
