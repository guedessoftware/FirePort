import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import * as snmp from 'net-snmp'
import type { OltSnmpDeviceConnection } from './olt-devices'
import { getOltSnmpDeviceConnectionById, isOltSecretDecryptionError } from './olt-devices'
import { prisma } from './prisma'
import { addProvisioningLog } from './provisioning-logs'

type SnmpVarbind = {
  oid: string
  type: number
  value: unknown
}

type SnmpSession = {
  subtree: (
    oid: string,
    maxRepetitions: number,
    feedCallback: (varbinds: SnmpVarbind[]) => boolean | void,
    doneCallback: (error: Error | null) => void,
  ) => void
  close: () => void
}

export const ZTE_TITAN_OIDS = {
  status: '1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4',
  lastOnline: '1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.5',
  lastOffline: '1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.6',
  rx: '1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10',
  tx: '1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.14',
  mac1: '1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.24',
  mac2: '1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.25',
} as const

export const DEFAULT_MONITORED_PORTS = [1, 2, 3, 4, 7, 8, 9]
  .flatMap((slot) => Array.from({ length: 16 }, (_item, index) => `1/${slot}/${index + 1}`))

export type OnuCurrentRow = {
  id: string
  provisioningId?: string | null
  serial?: string | null
  provisioningCreatedAt?: string | null
  provisioningUpdatedAt?: string | null
  cpeModelName?: string | null
  contractName?: string | null
  contractNumber?: string | null
  oltId: string
  oltName: string
  oltHost: string
  porta: string
  ponIndex: number
  onuId: number
  statusCode: number | null
  statusName: string | null
  rxDbm: number | null
  txDbm: number | null
  lastOnline: string | null
  lastOffline: string | null
  learnedMac: string | null
  collectedAt: string
}

export type OnuSnapshot = {
  oltId: string
  porta: string
  ponIndex: number
  onuId: number
  statusCode: number | null
  statusName: string | null
  rxDbm: number | null
  txDbm: number | null
  lastOnline: Date | null
  lastOffline: Date | null
  learnedMac: string | null
  collectedAt: Date
}

type SnapshotAccumulator = {
  oltId: string
  porta: string
  ponIndex: number
  onuId: number
  statusCode: number | null
  statusName: string | null
  rxRaw: number | null
  txRaw: number | null
  lastOnline: Date | null
  lastOffline: Date | null
  macs: Set<string>
}

export function portToPonIndex(port: string): number {
  const [rack, slot, pon] = port.split('/').map(Number)

  if (!Number.isInteger(rack) || !Number.isInteger(slot) || !Number.isInteger(pon) || rack < 1 || slot < 1 || pon < 1) {
    throw new Error(`Porta invalida: ${port}`)
  }

  const hex =
    '11'
    + rack.toString(16).padStart(2, '0')
    + slot.toString(16).padStart(2, '0')
    + pon.toString(16).padStart(2, '0')

  return parseInt(hex, 16)
}

export function ponIndexToPort(ponIndex: number) {
  const hex = ponIndex.toString(16).padStart(8, '0')
  if (!hex.startsWith('11')) {
    return String(ponIndex)
  }

  return [
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    parseInt(hex.slice(6, 8), 16),
  ].join('/')
}

export function statusName(code?: number | null): string | null {
  if (code === undefined || code === null) return null
  const map: Record<number, string> = {
    1: 'logging',
    2: 'los',
    3: 'syncMib',
    4: 'working',
    5: 'dyingGasp',
    6: 'authFailed',
    7: 'offline',
  }

  return map[code] ?? 'unknown'
}

export function rawOpticalToDbm(value?: number | null): number | null {
  if (value === undefined || value === null) return null
  if (value === 65535) return null

  if (value >= 0 && value <= 32767) {
    return Number((value * 0.002 - 30).toFixed(2))
  }

  return Number(((value - 65536) * 0.002 - 30).toFixed(2))
}

function toInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (Buffer.isBuffer(value) && value.length > 0) return Number.parseInt(value.toString('utf8'), 10)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bufferToDate(value: unknown) {
  if (!Buffer.isBuffer(value) || value.length < 7) {
    return null
  }

  const year = value.readUInt16BE(0)
  const month = value[2]
  const day = value[3]
  const hour = value[4]
  const minute = value[5]
  const second = value[6]

  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null
  }

  return new Date(year, month - 1, day, hour, minute, second)
}

function normalizeMacText(value: string) {
  const clean = value.trim().replace(/[^a-f0-9]/gi, '')
  if (clean.length === 12) {
    return clean.match(/.{1,2}/g)?.join(':').toUpperCase() ?? null
  }

  return value.trim() || null
}

function valueToMac(value: unknown) {
  if (Buffer.isBuffer(value)) {
    const printable = value.every((byte) => byte >= 32 && byte <= 126)
    if (printable) {
      return normalizeMacText(value.toString('utf8'))
    }

    if (value.length >= 6) {
      return Array.from(value.slice(0, 6))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(':')
        .toUpperCase()
    }
  }

  if (typeof value === 'string') {
    return normalizeMacText(value)
  }

  return null
}

function suffixParts(baseOid: string, oid: string) {
  const prefix = `${baseOid}.`
  if (!oid.startsWith(prefix)) {
    return []
  }

  return oid.slice(prefix.length).split('.').map(Number).filter((part) => Number.isInteger(part))
}

function key(ponIndex: number, onuId: number) {
  return `${ponIndex}:${onuId}`
}

function getOrCreate(accumulators: Map<string, SnapshotAccumulator>, oltId: string, ponIndex: number, onuId: number) {
  const recordKey = key(ponIndex, onuId)
  const current = accumulators.get(recordKey)
  if (current) {
    return current
  }

  const next: SnapshotAccumulator = {
    oltId,
    porta: ponIndexToPort(ponIndex),
    ponIndex,
    onuId,
    statusCode: null,
    statusName: null,
    rxRaw: null,
    txRaw: null,
    lastOnline: null,
    lastOffline: null,
    macs: new Set(),
  }
  accumulators.set(recordKey, next)
  return next
}

function walkSubtree(session: SnmpSession, baseOid: string) {
  return new Promise<SnmpVarbind[]>((resolve, reject) => {
    const result: SnmpVarbind[] = []
    let settled = false
    const timeoutMs = Number(process.env.ONU_SNMP_WALK_TIMEOUT_MS || 20_000)
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timeout SNMP ao consultar ${baseOid} apos ${timeoutMs}ms.`))
    }, timeoutMs)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    session.subtree(
      baseOid,
      Number(process.env.ONU_SNMP_MAX_REPETITIONS || 20),
      (varbinds) => {
        for (const varbind of varbinds) {
          if (snmp.isVarbindError(varbind)) {
            finish(() => reject(new Error(snmp.varbindError(varbind))))
            return true
          }
          result.push(varbind)
        }
        return false
      },
      (error) => {
        if (error) {
          finish(() => reject(error))
          return
        }
        finish(() => resolve(result))
      },
    )
  })
}

async function getActiveInterfacePorts(oltId: string) {
  const rows = await prisma.$queryRaw<Array<{ chassi: number; slot: number; pon: number }>>`
    SELECT "chassi", "slot", "pon"
    FROM "OltInterface"
    WHERE "oltDeviceId" = ${oltId} AND "isActive" = true AND upper("type") = 'GPON'
    ORDER BY "chassi", "slot", "pon"
  `

  return rows.length
    ? rows.map((row) => `${row.chassi}/${row.slot}/${row.pon}`)
    : DEFAULT_MONITORED_PORTS
}

function filterSnapshotsByPorts(snapshots: OnuSnapshot[], ports: string[]) {
  const allowed = new Set(ports)
  return snapshots.filter((snapshot) => allowed.has(snapshot.porta))
}

export async function collectOltOnusViaSnmp(device: OltSnmpDeviceConnection): Promise<OnuSnapshot[]> {
  if (!device.snmpEnabled) {
    return []
  }

  if (device.snmpVersion !== '2c') {
    throw new Error(`A OLT ${device.name} esta configurada com SNMP ${device.snmpVersion}; esta coleta suporta SNMP v2c.`)
  }

  if (!device.snmpCommunity) {
    throw new Error(`Configure a community SNMP da OLT ${device.name}.`)
  }

  const target = device.ipv4 || device.host
  const ports = await getActiveInterfacePorts(device.id)
  const session = snmp.createSession(target, device.snmpCommunity, {
    port: device.snmpPort || 161,
    version: snmp.Version2c,
    retries: Number(process.env.ONU_SNMP_RETRIES || 1),
    timeout: Number(process.env.ONU_SNMP_TIMEOUT_MS || 5000),
  })
  const records = new Map<string, SnapshotAccumulator>()

  try {
    const status = await walkSubtree(session, ZTE_TITAN_OIDS.status)
    const rx = await walkSubtree(session, ZTE_TITAN_OIDS.rx)
    const tx = await walkSubtree(session, ZTE_TITAN_OIDS.tx)
    const lastOnline = await walkSubtree(session, ZTE_TITAN_OIDS.lastOnline)
    const lastOffline = await walkSubtree(session, ZTE_TITAN_OIDS.lastOffline)
    const mac1 = await walkSubtree(session, ZTE_TITAN_OIDS.mac1).catch(() => [])
    const mac2 = await walkSubtree(session, ZTE_TITAN_OIDS.mac2).catch(() => [])

    for (const varbind of status) {
      const [ponIndex, onuId] = suffixParts(ZTE_TITAN_OIDS.status, varbind.oid)
      const statusCode = toInteger(varbind.value)
      if (!ponIndex || !onuId || statusCode === null) continue
      const record = getOrCreate(records, device.id, ponIndex, onuId)
      record.statusCode = statusCode
      record.statusName = statusName(statusCode)
    }

    for (const varbind of rx) {
      const [ponIndex, onuId] = suffixParts(ZTE_TITAN_OIDS.rx, varbind.oid)
      const value = toInteger(varbind.value)
      if (!ponIndex || !onuId || value === null) continue
      getOrCreate(records, device.id, ponIndex, onuId).rxRaw = value
    }

    for (const varbind of tx) {
      const [ponIndex, onuId] = suffixParts(ZTE_TITAN_OIDS.tx, varbind.oid)
      const value = toInteger(varbind.value)
      if (!ponIndex || !onuId || value === null) continue
      getOrCreate(records, device.id, ponIndex, onuId).txRaw = value
    }

    for (const varbind of lastOnline) {
      const [ponIndex, onuId] = suffixParts(ZTE_TITAN_OIDS.lastOnline, varbind.oid)
      if (!ponIndex || !onuId) continue
      getOrCreate(records, device.id, ponIndex, onuId).lastOnline = bufferToDate(varbind.value)
    }

    for (const varbind of lastOffline) {
      const [ponIndex, onuId] = suffixParts(ZTE_TITAN_OIDS.lastOffline, varbind.oid)
      if (!ponIndex || !onuId) continue
      getOrCreate(records, device.id, ponIndex, onuId).lastOffline = bufferToDate(varbind.value)
    }

    for (const varbind of [...mac1, ...mac2]) {
      const [ponIndex, onuId] = suffixParts(
        varbind.oid.startsWith(`${ZTE_TITAN_OIDS.mac1}.`) ? ZTE_TITAN_OIDS.mac1 : ZTE_TITAN_OIDS.mac2,
        varbind.oid,
      )
      const mac = valueToMac(varbind.value)
      if (!ponIndex || !onuId || !mac) continue
      getOrCreate(records, device.id, ponIndex, onuId).macs.add(mac)
    }
  } finally {
    session.close()
  }

  const collectedAt = new Date()
  return filterSnapshotsByPorts(
    Array.from(records.values()).map((record) => ({
      oltId: record.oltId,
      porta: record.porta,
      ponIndex: record.ponIndex,
      onuId: record.onuId,
      statusCode: record.statusCode,
      statusName: record.statusName,
      rxDbm: rawOpticalToDbm(record.rxRaw),
      txDbm: rawOpticalToDbm(record.txRaw),
      lastOnline: record.lastOnline,
      lastOffline: record.lastOffline,
      learnedMac: Array.from(record.macs).join(', ') || null,
      collectedAt,
    })),
    ports,
  )
}

async function createOnuEvent(input: {
  oltId: string
  ponIndex: number
  onuId: number
  eventType: string
  previousValue?: string | null
  currentValue?: string | null
}) {
  await prisma.$executeRaw`
    INSERT INTO "OnuEvent" ("id", "oltId", "ponIndex", "onuId", "eventType", "previousValue", "currentValue", "createdAt")
    VALUES (${randomUUID()}, ${input.oltId}, ${input.ponIndex}, ${input.onuId}, ${input.eventType}, ${input.previousValue ?? null}, ${input.currentValue ?? null}, CURRENT_TIMESTAMP)
  `
}

export async function saveOnuSnapshots(snapshots: OnuSnapshot[]) {
  let inserted = 0
  let updated = 0

  for (const snapshot of snapshots) {
    const previousRows = await prisma.$queryRaw<Array<{ statusName: string | null; rxDbm: number | null }>>`
      SELECT "statusName", "rxDbm"
      FROM "OnuCurrent"
      WHERE "oltId" = ${snapshot.oltId} AND "ponIndex" = ${snapshot.ponIndex} AND "onuId" = ${snapshot.onuId}
      LIMIT 1
    `
    const previous = previousRows[0] ?? null

    await prisma.$executeRaw`
      INSERT INTO "OnuCurrent" (
        "id",
        "oltId",
        "porta",
        "ponIndex",
        "onuId",
        "statusCode",
        "statusName",
        "rxDbm",
        "txDbm",
        "lastOnline",
        "lastOffline",
        "learnedMac",
        "collectedAt",
        "updatedAt"
      ) VALUES (
        ${randomUUID()},
        ${snapshot.oltId},
        ${snapshot.porta},
        ${snapshot.ponIndex},
        ${snapshot.onuId},
        ${snapshot.statusCode},
        ${snapshot.statusName},
        ${snapshot.rxDbm},
        ${snapshot.txDbm},
        ${snapshot.lastOnline},
        ${snapshot.lastOffline},
        ${snapshot.learnedMac},
        ${snapshot.collectedAt},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT("oltId", "ponIndex", "onuId") DO UPDATE SET
        "porta" = excluded."porta",
        "statusCode" = excluded."statusCode",
        "statusName" = excluded."statusName",
        "rxDbm" = excluded."rxDbm",
        "txDbm" = excluded."txDbm",
        "lastOnline" = excluded."lastOnline",
        "lastOffline" = excluded."lastOffline",
        "learnedMac" = excluded."learnedMac",
        "collectedAt" = excluded."collectedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `

    await prisma.$executeRaw`
      INSERT INTO "OnuHistory" ("id", "oltId", "porta", "ponIndex", "onuId", "statusCode", "statusName", "rxDbm", "txDbm", "collectedAt")
      VALUES (${randomUUID()}, ${snapshot.oltId}, ${snapshot.porta}, ${snapshot.ponIndex}, ${snapshot.onuId}, ${snapshot.statusCode}, ${snapshot.statusName}, ${snapshot.rxDbm}, ${snapshot.txDbm}, ${snapshot.collectedAt})
    `

    if (previous) {
      updated += 1
      if (previous.statusName !== snapshot.statusName) {
        await createOnuEvent({
          oltId: snapshot.oltId,
          ponIndex: snapshot.ponIndex,
          onuId: snapshot.onuId,
          eventType: 'status_changed',
          previousValue: previous.statusName,
          currentValue: snapshot.statusName,
        })
      }
      if ((previous.rxDbm === null || previous.rxDbm >= -25) && typeof snapshot.rxDbm === 'number' && snapshot.rxDbm < -25) {
        await createOnuEvent({
          oltId: snapshot.oltId,
          ponIndex: snapshot.ponIndex,
          onuId: snapshot.onuId,
          eventType: snapshot.rxDbm < -27 ? 'rx_critical' : 'rx_warning',
          previousValue: previous.rxDbm === null ? null : String(previous.rxDbm),
          currentValue: String(snapshot.rxDbm),
        })
      }
    } else {
      inserted += 1
    }
  }

  return { inserted, updated }
}

export async function listSnmpEnabledOltDevices() {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "OltDevice"
    WHERE "isActive" = true AND "snmpEnabled" = true
    ORDER BY "isDefault" DESC, "name" ASC
  `
  const devices: OltSnmpDeviceConnection[] = []

  for (const row of rows) {
    try {
      const device = await getOltSnmpDeviceConnectionById(row.id)
      if (device) {
        devices.push(device)
      }
    } catch (error) {
      if (!isOltSecretDecryptionError(error)) {
        throw error
      }

      console.error('[ONU MONITOR] OLT ignorada por credencial criptografada invalida', {
        oltId: error.oltId,
        oltName: error.oltName || row.name,
        field: error.field,
        message: error.message,
      })
    }
  }

  return devices
}

function dbDate(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  return null
}

function normalizeCurrentRow(row: OnuCurrentRow & {
  collectedAt: Date | string
  lastOnline: Date | string | null
  lastOffline: Date | string | null
  provisioningCreatedAt?: Date | string | null
  provisioningUpdatedAt?: Date | string | null
}) {
  return {
    ...row,
    ponIndex: Number(row.ponIndex),
    lastOnline: dbDate(row.lastOnline),
    lastOffline: dbDate(row.lastOffline),
    collectedAt: dbDate(row.collectedAt) ?? new Date().toISOString(),
    provisioningCreatedAt: dbDate(row.provisioningCreatedAt),
    provisioningUpdatedAt: dbDate(row.provisioningUpdatedAt),
  }
}

export async function listOnuCurrent(input: {
  userId: string
  role: string
  oltId?: string | null
  porta?: string | null
  status?: string | null
  rxBelow?: number | null
  search?: string | null
}) {
  if (input.role !== 'admin') {
    await ensureOperatorOnuAccessFromProvisionings(input.userId)
  }

  const conditions = ['1 = 1']
  const params: Array<string | number> = []

  if (input.oltId) {
    conditions.push('"OnuCurrent"."oltId" = ?')
    params.push(input.oltId)
  }
  if (input.porta) {
    conditions.push('"OnuCurrent"."porta" = ?')
    params.push(input.porta)
  }
  if (input.status) {
    conditions.push('"OnuCurrent"."statusName" = ?')
    params.push(input.status)
  }
  if (typeof input.rxBelow === 'number' && Number.isFinite(input.rxBelow)) {
    conditions.push('"OnuCurrent"."rxDbm" IS NOT NULL AND "OnuCurrent"."rxDbm" < ?')
    params.push(input.rxBelow)
  }
  if (input.search) {
    conditions.push('("OltDevice"."name" LIKE ? OR "OnuCurrent"."porta" LIKE ? OR "OnuCurrent"."learnedMac" LIKE ?)')
    const query = `%${input.search}%`
    params.push(query, query, query)
  }
  if (input.role !== 'admin') {
    conditions.push('"ProvisioningPosition"."provisioningId" IS NOT NULL')
    conditions.push('"ProvisioningPosition"."operatorUserId" = ?')
    params.push(input.userId)
  }

  const rows = await prisma.$queryRawUnsafe<Array<OnuCurrentRow & {
    collectedAt: Date | string
    lastOnline: Date | string | null
    lastOffline: Date | string | null
  }>>(`
    WITH "ProvisioningPosition" AS (
      SELECT *
      FROM (
        SELECT
          "Provisioning"."id" AS "provisioningId",
          "Provisioning"."serial",
          "Provisioning"."createdAt" AS "provisioningCreatedAt",
          "Provisioning"."updatedAt" AS "provisioningUpdatedAt",
          "Landlord"."userId" AS "operatorUserId",
          "CPEModel"."name" AS "cpeModelName",
          "Contract"."name" AS "contractName",
          "Contract"."contractNumber",
          COALESCE(
            json_extract("ProvisioningLog"."details", '$.matchedPosition.oltDeviceId'),
            json_extract("ProvisioningLog"."details", '$.oltDeviceId'),
            "OltInterface"."oltDeviceId"
          ) AS "oltId",
          (
            285212672
            + (CAST(COALESCE(json_extract("ProvisioningLog"."details", '$.matchedPosition.chassi'), json_extract("ProvisioningLog"."details", '$.chassi'), "OltInterface"."chassi") AS INTEGER) * 65536)
            + (CAST(COALESCE(json_extract("ProvisioningLog"."details", '$.matchedPosition.slot'), json_extract("ProvisioningLog"."details", '$.slot'), "OltInterface"."slot") AS INTEGER) * 256)
            + CAST(COALESCE(json_extract("ProvisioningLog"."details", '$.matchedPosition.pon'), json_extract("ProvisioningLog"."details", '$.pon'), "OltInterface"."pon") AS INTEGER)
          ) AS "ponIndex",
          CAST(COALESCE(
            json_extract("ProvisioningLog"."details", '$.matchedPosition.onuId'),
            json_extract("ProvisioningLog"."details", '$.selectedOnuId'),
            json_extract("ProvisioningLog"."details", '$.onuId')
          ) AS INTEGER) AS "onuId",
          ROW_NUMBER() OVER (
            PARTITION BY "Provisioning"."id"
            ORDER BY "ProvisioningLog"."createdAt" DESC
          ) AS "rowNumber"
        FROM "Provisioning"
        INNER JOIN "CPEModel" ON "CPEModel"."id" = "Provisioning"."cpeModelId"
        INNER JOIN "Contract" ON "Contract"."id" = "Provisioning"."contractId"
        INNER JOIN "Landlord" ON "Landlord"."id" = "Contract"."landlordId"
        INNER JOIN "Port" ON "Port"."id" = "Provisioning"."portId"
        INNER JOIN "CTO" ON "CTO"."id" = "Port"."ctoId"
        LEFT JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
        INNER JOIN "ProvisioningLog" ON "ProvisioningLog"."provisioningId" = "Provisioning"."id"
          AND json_valid("ProvisioningLog"."details")
          AND (
            json_extract("ProvisioningLog"."details", '$.matchedPosition.onuId') IS NOT NULL
            OR json_extract("ProvisioningLog"."details", '$.selectedOnuId') IS NOT NULL
            OR json_extract("ProvisioningLog"."details", '$.onuId') IS NOT NULL
          )
        WHERE "Provisioning"."status" = 'active'
      )
      WHERE "rowNumber" = 1 AND "onuId" IS NOT NULL AND "oltId" IS NOT NULL AND "ponIndex" IS NOT NULL
    )
    SELECT
      "OnuCurrent"."id",
      "ProvisioningPosition"."provisioningId",
      "ProvisioningPosition"."serial",
      "ProvisioningPosition"."provisioningCreatedAt",
      "ProvisioningPosition"."provisioningUpdatedAt",
      "ProvisioningPosition"."cpeModelName",
      "ProvisioningPosition"."contractName",
      "ProvisioningPosition"."contractNumber",
      "OnuCurrent"."oltId",
      "OltDevice"."name" AS "oltName",
      "OltDevice"."host" AS "oltHost",
      "OnuCurrent"."porta",
      "OnuCurrent"."ponIndex",
      "OnuCurrent"."onuId",
      "OnuCurrent"."statusCode",
      "OnuCurrent"."statusName",
      "OnuCurrent"."rxDbm",
      "OnuCurrent"."txDbm",
      "OnuCurrent"."lastOnline",
      "OnuCurrent"."lastOffline",
      "OnuCurrent"."learnedMac",
      "OnuCurrent"."collectedAt"
    FROM "OnuCurrent"
    INNER JOIN "OltDevice" ON "OltDevice"."id" = "OnuCurrent"."oltId"
    LEFT JOIN "ProvisioningPosition" ON "ProvisioningPosition"."oltId" = "OnuCurrent"."oltId"
      AND "ProvisioningPosition"."ponIndex" = "OnuCurrent"."ponIndex"
      AND "ProvisioningPosition"."onuId" = "OnuCurrent"."onuId"
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN "ProvisioningPosition"."provisioningUpdatedAt" IS NULL THEN 1 ELSE 0 END ASC,
      "ProvisioningPosition"."provisioningUpdatedAt" DESC,
      "OnuCurrent"."collectedAt" DESC,
      "OltDevice"."name" ASC,
      "OnuCurrent"."ponIndex" ASC,
      "OnuCurrent"."onuId" ASC
  `, ...params)

  return rows.map(normalizeCurrentRow)
}

export async function getOnuSummary(input: { userId: string; role: string }) {
  if (input.role !== 'admin') {
    const items = await listOnuCurrent({ userId: input.userId, role: input.role })
    return {
      total: items.length,
      online: items.filter((item) => item.statusName === 'working').length,
      los: items.filter((item) => item.statusName === 'los').length,
      offline: items.filter((item) => item.statusName === 'offline').length,
      dyingGasp: items.filter((item) => item.statusName === 'dyingGasp').length,
      warningSignal: items.filter((item) => item.rxDbm !== null && item.rxDbm < -25).length,
      criticalSignal: items.filter((item) => item.rxDbm !== null && item.rxDbm < -27).length,
    }
  }
  const conditions = ['1 = 1']
  const params: string[] = []
  if (input.role !== 'admin') {
    conditions.push(`EXISTS (
      SELECT 1
      FROM "OperatorOnuAccess"
      WHERE "OperatorOnuAccess"."userId" = ?
        AND "OperatorOnuAccess"."oltId" = "OnuCurrent"."oltId"
        AND "OperatorOnuAccess"."ponIndex" = "OnuCurrent"."ponIndex"
        AND "OperatorOnuAccess"."onuId" = "OnuCurrent"."onuId"
    )`)
    params.push(input.userId)
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    total: number | bigint
    online: number | bigint | null
    los: number | bigint | null
    offline: number | bigint | null
    dyingGasp: number | bigint | null
    warningSignal: number | bigint | null
    criticalSignal: number | bigint | null
  }>>(`
    SELECT
      COUNT(*) AS "total",
      SUM(CASE WHEN "OnuCurrent"."statusName" = 'working' THEN 1 ELSE 0 END) AS "online",
      SUM(CASE WHEN "OnuCurrent"."statusName" = 'los' THEN 1 ELSE 0 END) AS "los",
      SUM(CASE WHEN "OnuCurrent"."statusName" = 'offline' THEN 1 ELSE 0 END) AS "offline",
      SUM(CASE WHEN "OnuCurrent"."statusName" = 'dyingGasp' THEN 1 ELSE 0 END) AS "dyingGasp",
      SUM(CASE WHEN "OnuCurrent"."rxDbm" IS NOT NULL AND "OnuCurrent"."rxDbm" < -25 THEN 1 ELSE 0 END) AS "warningSignal",
      SUM(CASE WHEN "OnuCurrent"."rxDbm" IS NOT NULL AND "OnuCurrent"."rxDbm" < -27 THEN 1 ELSE 0 END) AS "criticalSignal"
    FROM "OnuCurrent"
    WHERE ${conditions.join(' AND ')}
  `, ...params)
  const summary = rows[0]
  const count = (value: number | bigint | null | undefined) => Number(value ?? 0)

  return {
    total: count(summary?.total),
    online: count(summary?.online),
    los: count(summary?.los),
    offline: count(summary?.offline),
    dyingGasp: count(summary?.dyingGasp),
    warningSignal: count(summary?.warningSignal),
    criticalSignal: count(summary?.criticalSignal),
  }
}

export async function listOnuHistory(input: { currentId: string; userId: string; role: string }) {
  const currentRows = await listOnuCurrent({ userId: input.userId, role: input.role })
  const current = currentRows.find((row) => row.id === input.currentId)
  if (!current) {
    return null
  }

  const rows = await prisma.$queryRaw<Array<{
    id: string
    statusCode: number | null
    statusName: string | null
    rxDbm: number | null
    txDbm: number | null
    collectedAt: Date | string
  }>>`
    SELECT "id", "statusCode", "statusName", "rxDbm", "txDbm", "collectedAt"
    FROM "OnuHistory"
    WHERE "oltId" = ${current.oltId} AND "ponIndex" = ${current.ponIndex} AND "onuId" = ${current.onuId}
    ORDER BY "collectedAt" DESC
    LIMIT 500
  `

  return {
    current,
    history: rows.map((row) => ({
      ...row,
      collectedAt: dbDate(row.collectedAt) ?? new Date().toISOString(),
    })),
  }
}

export async function grantOperatorOnuAccess(input: { userId: string; oltId: string; ponIndex: number; onuId: number }) {
  await prisma.$executeRaw`
    INSERT INTO "OperatorOnuAccess" ("id", "userId", "oltId", "ponIndex", "onuId", "createdAt")
    VALUES (${randomUUID()}, ${input.userId}, ${input.oltId}, ${input.ponIndex}, ${input.onuId}, CURRENT_TIMESTAMP)
    ON CONFLICT("userId", "oltId", "ponIndex", "onuId") DO NOTHING
  `
}

function parseJsonObject(value: string | null) {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function numberField(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key]
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function stringField(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positionFromText(value: string | null) {
  if (!value) {
    return null
  }

  const match = value.match(/\bgpon_onu-(\d+)\/(\d+)\/(\d+):(\d+)\b/i)
  if (!match) {
    return null
  }

  return {
    chassi: Number(match[1]),
    slot: Number(match[2]),
    pon: Number(match[3]),
    onuId: Number(match[4]),
  }
}

function positionFromLog(
  log: { message: string | null; details: string | null },
  fallbackInterface: { chassi: number | null; slot: number | null; pon: number | null },
) {
  const details = parseJsonObject(log.details)
  const matchedPosition = details?.matchedPosition && typeof details.matchedPosition === 'object'
    ? details.matchedPosition as Record<string, unknown>
    : null
  const matched = {
    chassi: numberField(matchedPosition, 'chassi'),
    slot: numberField(matchedPosition, 'slot'),
    pon: numberField(matchedPosition, 'pon'),
    onuId: numberField(matchedPosition, 'onuId'),
    oltDeviceId: stringField(matchedPosition, 'oltDeviceId'),
  }
  if (matched.chassi !== null && matched.slot !== null && matched.pon !== null && matched.onuId !== null) {
    return matched
  }

  const topLevelPosition = {
    chassi: numberField(details, 'chassi'),
    slot: numberField(details, 'slot'),
    pon: numberField(details, 'pon'),
    onuId: numberField(details, 'onuId'),
    oltDeviceId: stringField(details, 'oltDeviceId'),
  }
  if (
    topLevelPosition.chassi !== null
    && topLevelPosition.slot !== null
    && topLevelPosition.pon !== null
    && topLevelPosition.onuId !== null
  ) {
    return topLevelPosition
  }

  const fromDetailsText = positionFromText(log.details)
  if (fromDetailsText) {
    return fromDetailsText
  }

  const selectedOnuId = numberField(details, 'selectedOnuId')
  if (
    selectedOnuId !== null
    && fallbackInterface.chassi !== null
    && fallbackInterface.slot !== null
    && fallbackInterface.pon !== null
  ) {
    return {
      chassi: fallbackInterface.chassi,
      slot: fallbackInterface.slot,
      pon: fallbackInterface.pon,
      onuId: selectedOnuId,
      oltDeviceId: stringField(details, 'oltDeviceId'),
    }
  }

  return positionFromText(log.message)
}

export async function ensureOperatorOnuAccessFromProvisionings(userId?: string | null) {
  const userFilter = userId ? Prisma.sql`AND "Landlord"."userId" = ${userId}` : Prisma.empty
  const candidates = await prisma.$queryRaw<Array<{
    provisioningId: string
    userId: string
    oltDeviceId: string | null
    chassi: number | null
    slot: number | null
    pon: number | null
  }>>(Prisma.sql`
    SELECT
      "Provisioning"."id" AS "provisioningId",
      "Landlord"."userId" AS "userId",
      "OltInterface"."oltDeviceId",
      "OltInterface"."chassi",
      "OltInterface"."slot",
      "OltInterface"."pon"
    FROM "Provisioning"
    INNER JOIN "Contract" ON "Contract"."id" = "Provisioning"."contractId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "Contract"."landlordId"
    INNER JOIN "Port" ON "Port"."id" = "Provisioning"."portId"
    INNER JOIN "CTO" ON "CTO"."id" = "Port"."ctoId"
    LEFT JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
    WHERE "Provisioning"."status" = 'active'
      ${userFilter}
  `)

  if (candidates.length === 0) {
    return 0
  }

  const logs = await prisma.$queryRaw<Array<{
    provisioningId: string
    message: string | null
    details: string | null
  }>>`
    SELECT "provisioningId", "message", "details"
    FROM "ProvisioningLog"
    WHERE "provisioningId" IN (${Prisma.join(candidates.map((item) => item.provisioningId))})
      AND (
        "details" LIKE '%selectedOnuId%'
        OR "details" LIKE '%matchedPosition%'
        OR "details" LIKE '%gpon_onu-%'
        OR "message" LIKE '%posicao%'
        OR "message" LIKE '%posição%'
      )
    ORDER BY "createdAt" DESC
  `

  const logsByProvisioning = new Map<string, typeof logs>()
  for (const log of logs) {
    const current = logsByProvisioning.get(log.provisioningId) ?? []
    current.push(log)
    logsByProvisioning.set(log.provisioningId, current)
  }

  let granted = 0
  for (const candidate of candidates) {
    const provisioningLogs = logsByProvisioning.get(candidate.provisioningId) ?? []
    const position = provisioningLogs
      .map((log) => positionFromLog(log, candidate))
      .find((item): item is { chassi: number; slot: number; pon: number; onuId: number; oltDeviceId?: string | null } => Boolean(item))

    const oltDeviceId = position?.oltDeviceId ?? candidate.oltDeviceId
    if (!position || !oltDeviceId) {
      continue
    }

    await grantOperatorOnuAccess({
      userId: candidate.userId,
      oltId: oltDeviceId,
      ponIndex: portToPonIndex(`${position.chassi}/${position.slot}/${position.pon}`),
      onuId: position.onuId,
    })
    granted += 1
  }

  return granted
}

export async function syncProvisioningTelemetryFromOnuCurrent() {
  await ensureOperatorOnuAccessFromProvisionings()

  const rows = await prisma.$queryRaw<Array<{
    provisioningId: string
    previousStatusName: string | null
    currentId: string
    rxDbm: number | null
    txDbm: number | null
    statusName: string | null
  }>>`
    WITH "ProvisioningPosition" AS (
      SELECT *
      FROM (
        SELECT
          "Provisioning"."id" AS "provisioningId",
          "Provisioning"."onuStatus" AS "previousStatusName",
          COALESCE(
            json_extract("ProvisioningLog"."details", '$.matchedPosition.oltDeviceId'),
            json_extract("ProvisioningLog"."details", '$.oltDeviceId'),
            "OltInterface"."oltDeviceId"
          ) AS "oltId",
          (
            285212672
            + (CAST(COALESCE(json_extract("ProvisioningLog"."details", '$.matchedPosition.chassi'), json_extract("ProvisioningLog"."details", '$.chassi'), "OltInterface"."chassi") AS INTEGER) * 65536)
            + (CAST(COALESCE(json_extract("ProvisioningLog"."details", '$.matchedPosition.slot'), json_extract("ProvisioningLog"."details", '$.slot'), "OltInterface"."slot") AS INTEGER) * 256)
            + CAST(COALESCE(json_extract("ProvisioningLog"."details", '$.matchedPosition.pon'), json_extract("ProvisioningLog"."details", '$.pon'), "OltInterface"."pon") AS INTEGER)
          ) AS "ponIndex",
          CAST(COALESCE(
            json_extract("ProvisioningLog"."details", '$.matchedPosition.onuId'),
            json_extract("ProvisioningLog"."details", '$.selectedOnuId'),
            json_extract("ProvisioningLog"."details", '$.onuId')
          ) AS INTEGER) AS "onuId",
          ROW_NUMBER() OVER (
            PARTITION BY "Provisioning"."id"
            ORDER BY "ProvisioningLog"."createdAt" DESC
          ) AS "rowNumber"
        FROM "Provisioning"
        INNER JOIN "Port" ON "Port"."id" = "Provisioning"."portId"
        INNER JOIN "CTO" ON "CTO"."id" = "Port"."ctoId"
        LEFT JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
        INNER JOIN "ProvisioningLog" ON "ProvisioningLog"."provisioningId" = "Provisioning"."id"
          AND json_valid("ProvisioningLog"."details")
          AND (
            json_extract("ProvisioningLog"."details", '$.matchedPosition.onuId') IS NOT NULL
            OR json_extract("ProvisioningLog"."details", '$.selectedOnuId') IS NOT NULL
            OR json_extract("ProvisioningLog"."details", '$.onuId') IS NOT NULL
          )
        WHERE "Provisioning"."status" = 'active'
      )
      WHERE "rowNumber" = 1 AND "onuId" IS NOT NULL AND "oltId" IS NOT NULL AND "ponIndex" IS NOT NULL
    )
    SELECT
      "ProvisioningPosition"."provisioningId",
      "ProvisioningPosition"."previousStatusName",
      "OnuCurrent"."id" AS "currentId",
      "OnuCurrent"."rxDbm",
      "OnuCurrent"."txDbm",
      "OnuCurrent"."statusName"
    FROM "ProvisioningPosition"
    INNER JOIN "OnuCurrent" ON "OnuCurrent"."oltId" = "ProvisioningPosition"."oltId"
      AND "OnuCurrent"."ponIndex" = "ProvisioningPosition"."ponIndex"
      AND "OnuCurrent"."onuId" = "ProvisioningPosition"."onuId"
  `

  for (const row of rows) {
    if (row.statusName?.toLowerCase() === 'los' && row.previousStatusName?.toLowerCase() !== 'los') {
      await addProvisioningLog({
        provisioningId: row.provisioningId,
        level: 'warn',
        stage: 'onu.status.los',
        message: 'ONU/CPE entrou em LOS.',
        details: {
          previousStatus: row.previousStatusName,
          status: row.statusName,
          rxDbm: row.rxDbm,
          txDbm: row.txDbm,
          onuCurrentId: row.currentId,
        },
      })
    }

    await prisma.$executeRaw`
      UPDATE "Provisioning"
      SET
        "signal" = ${typeof row.rxDbm === 'number' ? Math.round(row.rxDbm) : null},
        "onuStatus" = ${row.statusName},
        "onuRxPower" = ${row.rxDbm},
        "onuTxPower" = ${row.txDbm}
      WHERE "id" = ${row.provisioningId}
    `
  }

  return rows.length
}

export async function deleteOldOnuHistory(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  await prisma.$executeRaw`
    DELETE FROM "OnuHistory"
    WHERE "collectedAt" < ${cutoff}
  `
}

export function prismaJoinNumber(values: number[]) {
  return Prisma.join(values)
}
