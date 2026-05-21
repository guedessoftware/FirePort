import { randomUUID } from 'crypto'
import { prisma } from './prisma'

export type OltInterfaceRow = {
  id: string
  hubsoftId: string | null
  oltDeviceId: string
  type: string
  name: string
  description: string | null
  chassi: number
  slot: number
  pon: number
  vlan: number | null
  routingInterface: string | null
  defaultCpeProfileId: string | null
  requireCtoLink: boolean | number
  blockOverutilization: boolean | number
  enableScan: boolean | number
  scanType: string | null
  alarmSubscriberSignal: number | null
  alarmEquipmentSignal: number | null
  sequencePort: number | null
  isActive: boolean | number
  createdAt: Date | string
  updatedAt: Date | string
}

export type OltInterfaceInput = {
  id?: string
  hubsoftId?: string | null
  oltDeviceId: string
  type: string
  name: string
  description?: string | null
  chassi: number
  slot: number
  pon: number
  vlan?: number | null
  routingInterface?: string | null
  defaultCpeProfileId?: string | null
  requireCtoLink?: boolean
  blockOverutilization?: boolean
  enableScan?: boolean
  scanType?: string | null
  alarmSubscriberSignal?: number | null
  alarmEquipmentSignal?: number | null
  sequencePort?: number | null
  isActive?: boolean
}

export type BulkOltInterfaceInput = {
  oltDeviceId: string
  type: string
  namePrefix?: string
  chassiStart: number
  chassiEnd: number
  slotStart: number
  slotEnd: number
  ponStart: number
  ponEnd: number
  vlanStart?: number | null
  vlanIncrement?: number
  routingInterface?: string | null
  defaultCpeProfileId?: string | null
  requireCtoLink?: boolean
  blockOverutilization?: boolean
  enableScan?: boolean
  scanType?: string | null
  alarmSubscriberSignal?: number | null
  alarmEquipmentSignal?: number | null
}

export function normalizeOltInterface(row: OltInterfaceRow) {
  return {
    ...row,
    requireCtoLink: Boolean(row.requireCtoLink),
    blockOverutilization: Boolean(row.blockOverutilization),
    enableScan: Boolean(row.enableScan),
    isActive: Boolean(row.isActive),
  }
}

export async function listOltInterfaces(oltDeviceId?: string) {
  const rows = oltDeviceId
    ? await prisma.$queryRaw<OltInterfaceRow[]>`
        SELECT * FROM OltInterface
        WHERE oltDeviceId = ${oltDeviceId}
        ORDER BY type ASC, chassi ASC, slot ASC, pon ASC, sequencePort ASC
      `
    : await prisma.$queryRaw<OltInterfaceRow[]>`
        SELECT * FROM OltInterface
        ORDER BY type ASC, chassi ASC, slot ASC, pon ASC, sequencePort ASC
      `

  return rows.map(normalizeOltInterface)
}

export async function getDefaultOltInterface(oltDeviceId: string) {
  const rows = await prisma.$queryRaw<OltInterfaceRow[]>`
    SELECT * FROM OltInterface
    WHERE oltDeviceId = ${oltDeviceId}
      AND isActive = true
      AND type = 'GPON'
    ORDER BY chassi ASC, slot ASC, pon ASC, sequencePort ASC
    LIMIT 1
  `

  return rows[0] ? normalizeOltInterface(rows[0]) : null
}

export async function upsertOltInterface(input: OltInterfaceInput) {
  const id = input.id || randomUUID()
  const requireCtoLink = input.requireCtoLink ?? false
  const blockOverutilization = input.blockOverutilization ?? false
  const enableScan = input.enableScan ?? true
  const isActive = input.isActive ?? true
  const currentRows = input.id
    ? await prisma.$queryRaw<OltInterfaceRow[]>`
        SELECT * FROM OltInterface WHERE id = ${input.id} LIMIT 1
      `
    : []
  const current = currentRows[0]
  const hubsoftId = input.hubsoftId === undefined ? current?.hubsoftId ?? null : input.hubsoftId

  if (input.id) {
    await prisma.$executeRaw`
      UPDATE OltInterface
      SET
        hubsoftId = ${hubsoftId},
        oltDeviceId = ${input.oltDeviceId},
        type = ${input.type},
        name = ${input.name},
        description = ${input.description ?? null},
        chassi = ${input.chassi},
        slot = ${input.slot},
        pon = ${input.pon},
        vlan = ${input.vlan ?? null},
        routingInterface = ${input.routingInterface ?? null},
        defaultCpeProfileId = ${input.defaultCpeProfileId ?? null},
        requireCtoLink = ${requireCtoLink},
        blockOverutilization = ${blockOverutilization},
        enableScan = ${enableScan},
        scanType = ${input.scanType ?? null},
        alarmSubscriberSignal = ${input.alarmSubscriberSignal ?? null},
        alarmEquipmentSignal = ${input.alarmEquipmentSignal ?? null},
        sequencePort = ${input.sequencePort ?? null},
        isActive = ${isActive},
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${input.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO OltInterface (
        id,
        hubsoftId,
        oltDeviceId,
        type,
        name,
        description,
        chassi,
        slot,
        pon,
        vlan,
        routingInterface,
        defaultCpeProfileId,
        requireCtoLink,
        blockOverutilization,
        enableScan,
        scanType,
        alarmSubscriberSignal,
        alarmEquipmentSignal,
        sequencePort,
        isActive,
        updatedAt
      ) VALUES (
        ${id},
        ${hubsoftId},
        ${input.oltDeviceId},
        ${input.type},
        ${input.name},
        ${input.description ?? null},
        ${input.chassi},
        ${input.slot},
        ${input.pon},
        ${input.vlan ?? null},
        ${input.routingInterface ?? null},
        ${input.defaultCpeProfileId ?? null},
        ${requireCtoLink},
        ${blockOverutilization},
        ${enableScan},
        ${input.scanType ?? null},
        ${input.alarmSubscriberSignal ?? null},
        ${input.alarmEquipmentSignal ?? null},
        ${input.sequencePort ?? null},
        ${isActive},
        CURRENT_TIMESTAMP
      )
    `
  }

  const rows = await prisma.$queryRaw<OltInterfaceRow[]>`
    SELECT * FROM OltInterface WHERE id = ${id} LIMIT 1
  `

  return rows[0] ? normalizeOltInterface(rows[0]) : null
}

export async function bulkCreateOltInterfaces(input: BulkOltInterfaceInput) {
  const created = []
  let sequence = 1
  let vlan = input.vlanStart ?? null
  const vlanIncrement = input.vlanIncrement ?? 0

  for (let chassi = input.chassiStart; chassi <= input.chassiEnd; chassi += 1) {
    for (let slot = input.slotStart; slot <= input.slotEnd; slot += 1) {
      for (let pon = input.ponStart; pon <= input.ponEnd; pon += 1) {
        const description = `${input.type} - ${chassi}/${slot}/${pon}`
        const name = input.namePrefix ? `${input.namePrefix} ${chassi}/${slot}/${pon}` : description
        const item = await upsertOltInterface({
          oltDeviceId: input.oltDeviceId,
          type: input.type,
          name,
          description,
          chassi,
          slot,
          pon,
          vlan,
          routingInterface: input.routingInterface,
          defaultCpeProfileId: input.defaultCpeProfileId,
          requireCtoLink: input.requireCtoLink,
          blockOverutilization: input.blockOverutilization,
          enableScan: input.enableScan,
          scanType: input.scanType,
          alarmSubscriberSignal: input.alarmSubscriberSignal,
          alarmEquipmentSignal: input.alarmEquipmentSignal,
          sequencePort: sequence,
          isActive: true,
        })
        created.push(item)
        sequence += 1
        if (vlan !== null) {
          vlan += vlanIncrement
        }
      }
    }
  }

  return created
}
