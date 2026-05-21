import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchHubsoftCTOs } from '@/lib/hubsoft'
import { requireAdmin, requireAuthenticated } from '@/lib/api-auth'

type CtoResponse = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  hubsoftId: string | null
  hubsoftOltDeviceId: string | null
  hubsoftOltInterfaceId: string | null
  oltDeviceName: string | null
  oltIpv4: string | null
  oltInterfaceName: string | null
  oltInterfaceType: string | null
  oltInterfaceIdentifier: string | null
  oltChassi: number | null
  oltSlot: number | null
  oltPon: number | null
  oltVlan: number | null
  oltInterfaceId: string | null
  oltInterface: {
    id: string
    oltDeviceId: string
    name: string
    description: string | null
    chassi: number
    slot: number
    pon: number
    vlan: number | null
    oltDevice: {
      id: string
      name: string
      host: string
      ipv4: string | null
    }
  } | null
  lastSync: Date | null
  syncStatus: string | null
  syncError: string | null
  ports: { id: string; number: number; status: string; ctoId: string }[]
}

type CtoRow = Omit<CtoResponse, 'ports' | 'oltInterface'> & {
  linkedInterfaceId: string | null
  linkedOltDeviceId: string | null
  linkedInterfaceName: string | null
  linkedInterfaceDescription: string | null
  linkedChassi: number | null
  linkedSlot: number | null
  linkedPon: number | null
  linkedVlan: number | null
  linkedOltDeviceName: string | null
  linkedOltDeviceHost: string | null
  linkedOltDeviceIpv4: string | null
}

type LinkedOltInterfaceRow = {
  id: string
  hubsoftId: string | null
  name: string
  type: string
  chassi: number
  slot: number
  pon: number
  vlan: number | null
  description: string | null
  oltDeviceId: string
  oltDeviceName: string
  oltIpv4: string | null
  host: string
  hubsoftOltDeviceId: string | null
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

function mapCtoRow(row: CtoRow, ports: CtoResponse['ports']): CtoResponse {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    hubsoftId: row.hubsoftId,
    hubsoftOltDeviceId: row.hubsoftOltDeviceId,
    hubsoftOltInterfaceId: row.hubsoftOltInterfaceId,
    oltDeviceName: row.oltDeviceName,
    oltIpv4: row.oltIpv4,
    oltInterfaceName: row.oltInterfaceName,
    oltInterfaceType: row.oltInterfaceType,
    oltInterfaceIdentifier: row.oltInterfaceIdentifier,
    oltChassi: row.oltChassi,
    oltSlot: row.oltSlot,
    oltPon: row.oltPon,
    oltVlan: row.oltVlan,
    oltInterfaceId: row.oltInterfaceId,
    lastSync: row.lastSync,
    syncStatus: row.syncStatus,
    syncError: row.syncError,
    ports,
    oltInterface: row.linkedInterfaceId && row.linkedOltDeviceId && row.linkedInterfaceName && row.linkedChassi !== null && row.linkedSlot !== null && row.linkedPon !== null
      ? {
          id: row.linkedInterfaceId,
          oltDeviceId: row.linkedOltDeviceId,
          name: row.linkedInterfaceName,
          description: row.linkedInterfaceDescription,
          chassi: row.linkedChassi,
          slot: row.linkedSlot,
          pon: row.linkedPon,
          vlan: row.linkedVlan,
          oltDevice: {
            id: row.linkedOltDeviceId,
            name: row.linkedOltDeviceName || 'OLT',
            host: row.linkedOltDeviceHost || '',
            ipv4: row.linkedOltDeviceIpv4,
          },
        }
      : null,
  }
}

async function listLocalCtos() {
  const ctoRows = await prisma.$queryRaw<CtoRow[]>`
    SELECT
      "CTO"."id",
      "CTO"."name",
      "CTO"."address",
      "CTO"."lat",
      "CTO"."lng",
      "CTO"."hubsoftId",
      "CTO"."hubsoftOltDeviceId",
      "CTO"."hubsoftOltInterfaceId",
      "CTO"."oltDeviceName",
      "CTO"."oltIpv4",
      "CTO"."oltInterfaceName",
      "CTO"."oltInterfaceType",
      "CTO"."oltInterfaceIdentifier",
      "CTO"."oltChassi",
      "CTO"."oltSlot",
      "CTO"."oltPon",
      "CTO"."oltVlan",
      "CTO"."oltInterfaceId",
      "CTO"."lastSync",
      "CTO"."syncStatus",
      "CTO"."syncError",
      "OltInterface"."id" AS "linkedInterfaceId",
      "OltInterface"."oltDeviceId" AS "linkedOltDeviceId",
      "OltInterface"."name" AS "linkedInterfaceName",
      "OltInterface"."description" AS "linkedInterfaceDescription",
      "OltInterface"."chassi" AS "linkedChassi",
      "OltInterface"."slot" AS "linkedSlot",
      "OltInterface"."pon" AS "linkedPon",
      "OltInterface"."vlan" AS "linkedVlan",
      "OltDevice"."name" AS "linkedOltDeviceName",
      "OltDevice"."host" AS "linkedOltDeviceHost",
      "OltDevice"."ipv4" AS "linkedOltDeviceIpv4"
    FROM "CTO"
    LEFT JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
    LEFT JOIN "OltDevice" ON "OltDevice"."id" = "OltInterface"."oltDeviceId"
    ORDER BY "CTO"."name" ASC
  `

  const ports = await prisma.port.findMany({ orderBy: [{ ctoId: 'asc' }, { number: 'asc' }] })
  const portsByCto = ports.reduce<Record<string, CtoResponse['ports']>>((groups, port) => {
    groups[port.ctoId] = groups[port.ctoId] ?? []
    groups[port.ctoId].push(port)
    return groups
  }, {})

  return ctoRows.map((row) => mapCtoRow(row, portsByCto[row.id] ?? []))
}

export async function GET() {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let ctos: CtoResponse[] = []
  
  // Try local database first
  try {
    ctos = await listLocalCtos()
  } catch (dbError) {
    console.error('Local CTO find error:', dbError)
    ctos = []
  }

  // Only try Hubsoft if no local CTOs found and URL is configured
  if (ctos.length === 0 && process.env.HUBSOFT_API_URL) {
    try {
      const hubsoftCtos = await fetchHubsoftCTOs()
      // Convert Hubsoft CTOs to local format
      ctos = hubsoftCtos.map((cto) => ({
        id: cto.id,
        name: cto.name,
        address: cto.address,
        lat: cto.lat,
        lng: cto.lng,
        hubsoftId: cto.id,
        hubsoftOltDeviceId: cto.oltInterface?.hubsoftOltDeviceId ?? null,
        hubsoftOltInterfaceId: cto.oltInterface?.hubsoftInterfaceId ?? null,
        oltDeviceName: cto.oltInterface?.oltName ?? null,
        oltIpv4: cto.oltInterface?.oltIpv4 ?? null,
        oltInterfaceName: cto.oltInterface?.name ?? null,
        oltInterfaceType: cto.oltInterface?.type ?? null,
        oltInterfaceIdentifier: cto.oltInterface?.identifier ?? null,
        oltChassi: cto.oltInterface?.chassi ?? null,
        oltSlot: cto.oltInterface?.slot ?? null,
        oltPon: cto.oltInterface?.pon ?? null,
        oltVlan: cto.oltInterface?.vlan ?? null,
        oltInterfaceId: null,
        oltInterface: null,
        lastSync: null,
        syncStatus: null,
        syncError: null,
        ports: cto.ports?.map((port) => ({
          id: port.id,
          number: port.number,
          status: port.status,
          ctoId: cto.id,
        })) || [],
      }))
    } catch (hubsoftError) {
      console.warn('Hubsoft integration failed:', hubsoftError)
      // Return empty array if Hubsoft fails and no local CTOs
      if (ctos.length === 0) {
        return NextResponse.json({ error: 'No CTOs found', details: String(hubsoftError) }, { status: 200 })
      }
    }
  }

  return NextResponse.json(ctos)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { id, name, address, lat, lng, ports } = await request.json()

    if (!name || !lat || !lng) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    let cto

    if (id) {
      cto = await prisma.cTO.upsert({
        where: { id },
        update: { name, address, lat, lng },
        create: { id, name, address, lat, lng },
      })
    } else {
      const existingCto = await prisma.cTO.findFirst({
        where: { name },
      })

      if (existingCto) {
        cto = await prisma.cTO.update({
          where: { id: existingCto.id },
          data: { address, lat, lng },
        })
      } else {
        cto = await prisma.cTO.create({
          data: { name, address, lat, lng },
        })
      }
    }

    if (ports && Array.isArray(ports)) {
      for (const port of ports) {
        const existingPort = await prisma.port.findFirst({
          where: {
            ctoId: cto.id,
            number: port.number,
          },
        })

        if (existingPort) {
          // Only update status if not provisioned
          if (existingPort.status !== 'provisioned') {
            await prisma.port.update({
              where: { id: existingPort.id },
              data: { status: port.status },
            })
          }
        } else {
          await prisma.port.create({
            data: {
              number: port.number,
              status: port.status,
              ctoId: cto.id,
            },
          })
        }
      }
    }

    return NextResponse.json(await prisma.cTO.findUnique({
      where: { id: cto.id },
      include: { ports: true },
    }))
  } catch (error: unknown) {
    console.error(error)
    return NextResponse.json({ error: (error instanceof Error ? error.message : String(error)) || 'Failed to save CTO' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json()
    const id = text(body.id)
    const name = text(body.name)
    const address = optionalText(body.address) ?? ''
    const lat = numberValue(body.lat)
    const lng = numberValue(body.lng)
    const oltInterfaceId = optionalText(body.oltInterfaceId)

    if (!id || !name || lat === undefined || lng === undefined) {
      return NextResponse.json({ error: 'ID, nome, latitude e longitude sao obrigatorios.' }, { status: 400 })
    }

    const existing = await prisma.cTO.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'CTO nao encontrada.' }, { status: 404 })
    }

    let linkedInterface: LinkedOltInterfaceRow | null = null

    if (oltInterfaceId) {
      const rows = await prisma.$queryRaw<LinkedOltInterfaceRow[]>`
        SELECT
          "OltInterface"."id",
          "OltInterface"."hubsoftId",
          "OltInterface"."name",
          "OltInterface"."type",
          "OltInterface"."chassi",
          "OltInterface"."slot",
          "OltInterface"."pon",
          "OltInterface"."vlan",
          "OltInterface"."description",
          "OltInterface"."oltDeviceId",
          "OltDevice"."name" AS "oltDeviceName",
          "OltDevice"."ipv4",
          "OltDevice"."host",
          "OltDevice"."hubsoftId" AS "hubsoftOltDeviceId"
        FROM "OltInterface"
        INNER JOIN "OltDevice" ON "OltDevice"."id" = "OltInterface"."oltDeviceId"
        WHERE "OltInterface"."id" = ${oltInterfaceId}
        LIMIT 1
      `
      linkedInterface = rows[0]

      if (!linkedInterface) {
        return NextResponse.json({ error: 'Interface da OLT nao encontrada.' }, { status: 400 })
      }
    }

    await prisma.cTO.update({
      where: { id },
      data: { name, address, lat, lng },
    })

    await prisma.$executeRaw`
      UPDATE "CTO"
      SET
        "hubsoftOltDeviceId" = ${linkedInterface?.hubsoftOltDeviceId ?? null},
        "hubsoftOltInterfaceId" = ${linkedInterface?.hubsoftId ?? null},
        "oltDeviceName" = ${linkedInterface?.oltDeviceName ?? null},
        "oltIpv4" = ${linkedInterface?.oltIpv4 ?? linkedInterface?.host ?? null},
        "oltInterfaceName" = ${linkedInterface?.name ?? null},
        "oltInterfaceType" = ${linkedInterface?.type ?? null},
        "oltInterfaceIdentifier" = ${linkedInterface ? `${linkedInterface.chassi}/${linkedInterface.slot}/${linkedInterface.pon}` : null},
        "oltChassi" = ${linkedInterface?.chassi ?? null},
        "oltSlot" = ${linkedInterface?.slot ?? null},
        "oltPon" = ${linkedInterface?.pon ?? null},
        "oltVlan" = ${linkedInterface?.vlan ?? null},
        "oltInterfaceId" = ${linkedInterface?.id ?? null},
        "syncError" = NULL
      WHERE "id" = ${id}
    `

    const ctos = await listLocalCtos()
    return NextResponse.json(ctos.find((cto) => cto.id === id) ?? null)
  } catch (error: unknown) {
    console.error('CTO update error:', error)
    return NextResponse.json({ error: (error instanceof Error ? error.message : String(error)) || 'Erro ao atualizar CTO.' }, { status: 500 })
  }
}
