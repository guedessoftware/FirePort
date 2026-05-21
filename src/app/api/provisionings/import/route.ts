import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]/route'
import { activateBillingServiceForProvisioning } from '@/lib/billing'
import { grantOperatorOnuAccess, portToPonIndex } from '@/lib/onu-snmp'
import { assertPortalMutationAllowed } from '@/lib/access-control'
import { getOltDeviceConnectionById } from '@/lib/olt-devices'
import { queryOltOnuBySerial } from '@/lib/olt-management'
import { shouldPersistProvisioningLog } from '@/lib/provisioning-logs'

type ImportRowStatus = 'imported' | 'updated' | 'skipped' | 'valid' | 'failed'

type ImportRowResult = {
  line: number
  status: ImportRowStatus
  message: string
  contractNumber?: string
  serial?: string
  provisioningId?: string
  ctoName?: string
  portNumber?: number
  oltPort?: string
}

type OnuAccessGrant = {
  userId: string
  oltId: string
  ponIndex: number
  onuId: number
}

type ImportedOnuLookup = {
  userId: string
  oltId: string
  serial: string
  expectedChassi: number
  expectedSlot: number
  expectedPon: number
}

type ImportOltInterface = {
  id: string
  oltDeviceId: string
  chassi: number
  slot: number
  pon: number
}

type ImportOltPositionTarget = {
  oltDeviceId: string
  chassi: number
  slot: number
  pon: number
}

type ImportCtoRow = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

type OltPortPosition = {
  chassi: number
  slot: number
  pon: number
}

class ImportRowError extends Error {
  rowDetails: Partial<ImportRowResult>

  constructor(message: string, rowDetails: Partial<ImportRowResult> = {}) {
    super(message)
    this.name = 'ImportRowError'
    this.rowDetails = rowDetails
  }
}

type CsvRecord = {
  line: number
  values: string[]
}

type ParsedCsv = {
  headers: string[]
  records: CsvRecord[]
}

const COLUMN_ALIASES = {
  operatorEmail: ['operador_email', 'email_operador', 'operator_email', 'operator'],
  clientName: ['cliente', 'nome_cliente', 'nome', 'name', 'client_name'],
  contractNumber: ['contrato', 'numero_contrato', 'contrato_numero', 'contract_number', 'contractnumber', 'id_contrato'],
  cep: ['cep', 'postal_code'],
  address: ['endereco', 'endereco_completo', 'address', 'logradouro'],
  number: ['numero', 'numero_endereco', 'number', 'num'],
  complement: ['complemento', 'complement', 'apt', 'apartamento'],
  reference: ['referencia', 'ponto_referencia', 'reference'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'longitude'],
  ctoId: ['cto_id', 'id_cto'],
  ctoHubsoftId: ['cto_hubsoft_id', 'hubsoft_cto_id', 'id_cto_hubsoft'],
  ctoName: ['cto', 'nome_cto', 'caixa', 'caixa_atendimento'],
  portId: ['porta_id', 'port_id', 'id_porta'],
  ctoPortNumber: ['porta_cto', 'numero_porta_cto', 'porta_ocupacao', 'ocupacao_porta', 'porta_atendimento', 'numero_porta', 'port_number'],
  oltPort: ['porta_olt', 'porta_pon', 'pon', 'pon_port', 'interface_olt', 'porta'],
  oltHost: ['olt', 'olt_host', 'olt_ip', 'host_olt', 'ip_olt'],
  cpeModelId: ['modelo_cpe_id', 'cpe_model_id', 'id_modelo_cpe'],
  cpeModel: ['modelo_cpe', 'cpe_modelo', 'modelo', 'cpe', 'equipamento'],
  serial: ['serial', 'serial_gpon', 'onu_serial', 'sn', 'gpon_sn'],
  signal: ['sinal', 'signal', 'rx'],
  status: ['status', 'situacao'],
  activatedAt: ['data_ativacao', 'provisionado_em', 'activated_at'],
  onuId: ['onu_id', 'id_onu', 'onu'],
} satisfies Record<string, string[]>

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessao invalida ou expirada. Faca login novamente.',
  }, { status: 401 })
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: string) {
  const clean = value.trim()
  return clean || null
}

function parseNumber(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value: string) {
  if (!/^-?\d+$/.test(value.trim())) return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isInteger(parsed) ? parsed : null
}

function parseOltPort(value: string): OltPortPosition | null {
  const match = value.trim().match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/)
  if (!match) return null

  return {
    chassi: Number.parseInt(match[1], 10),
    slot: Number.parseInt(match[2], 10),
    pon: Number.parseInt(match[3], 10),
  }
}

function normalizeStatus(value: string) {
  const normalized = normalizeHeader(value)
  if (!normalized) return 'active'
  if (['ativo', 'active', 'provisionado', 'importado'].includes(normalized)) return 'active'
  if (['inativo', 'inactive', 'cancelado', 'desativado'].includes(normalized)) return 'inactive'
  if (['pendente', 'oltpending', 'aguardando'].includes(normalized)) return 'olt_pending'
  if (['falha', 'oltfailed', 'erro'].includes(normalized)) return 'olt_failed'
  return value.trim()
}

function parseDate(value: string) {
  if (!value.trim()) return new Date()
  const normalized = value.trim().includes('/') ? value.trim().split('/').reverse().join('-') : value.trim()
  const date = new Date(normalized.length === 10 ? `${normalized}T00:00:00` : normalized)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function detectDelimiter(input: string) {
  const candidates = [',', ';', '\t']
  const firstLine = input.split(/\r?\n/, 1)[0] ?? ''
  const counts = candidates.map((delimiter) => ({
    delimiter,
    count: firstLine.split(delimiter).length - 1,
  }))
  counts.sort((left, right) => right.count - left.count)
  return counts[0]?.count ? counts[0].delimiter : ','
}

function parseCsv(input: string): ParsedCsv {
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const delimiter = detectDelimiter(source)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  row.push(field)
  rows.push(row)

  const [rawHeaders = [], ...rawRecords] = rows.filter((entry) => entry.some((value) => value.trim()))
  const headers = rawHeaders.map((header) => header.trim())
  const records = rawRecords
    .map((values, index) => ({ line: index + 2, values }))
    .filter((record) => record.values.some((value) => value.trim()))

  return { headers, records }
}

function buildAccessor(headers: string[]) {
  const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]))

  return (row: string[], aliases: readonly string[]) => {
    for (const alias of aliases) {
      const index = headerMap.get(normalizeHeader(alias))
      if (index !== undefined) return text(row[index])
    }

    return ''
  }
}

function serializeDetails(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ serializationError: 'Nao foi possivel serializar os detalhes.' })
  }
}

async function createProvisioningLog(
  db: Prisma.TransactionClient | typeof prisma,
  input: {
    provisioningId: string
    level?: 'info' | 'success' | 'warn' | 'error'
    stage: string
    message: string
    details?: unknown
  },
) {
  if (!shouldPersistProvisioningLog(input)) {
    return
  }

  await db.$executeRaw`
    INSERT INTO ProvisioningLog (
      id,
      provisioningId,
      level,
      stage,
      message,
      details
    ) VALUES (
      lower(hex(randomblob(16))),
      ${input.provisioningId},
      ${input.level ?? 'info'},
      ${input.stage},
      ${input.message},
      ${input.details === undefined ? null : serializeDetails(input.details)}
    )
  `
}

async function ensureLandlordForUser(tx: Prisma.TransactionClient, user: { id: string; email: string; name: string | null }) {
  const existing = await tx.landlord.findUnique({ where: { userId: user.id } })
  if (existing) return existing

  return tx.landlord.create({
    data: {
      name: user.name || user.email,
      userId: user.id,
    },
  })
}

async function resolveImportLandlord(
  tx: Prisma.TransactionClient,
  currentUser: { id: string; email: string; name: string | null; role: string },
  baseLandlordId: string,
  operatorEmail: string,
  dryRun: boolean,
) {
  if (currentUser.role !== 'admin' || !operatorEmail) return baseLandlordId

  const operator = await tx.user.findUnique({ where: { email: operatorEmail } })
  if (!operator) {
    throw new Error(`Operador ${operatorEmail} nao encontrado.`)
  }

  const existing = await tx.landlord.findUnique({ where: { userId: operator.id } })
  if (existing) return existing.id
  if (dryRun) return `dry-run:${operator.id}`

  const landlord = await ensureLandlordForUser(tx, operator)
  return landlord.id
}

async function findCpeModel(tx: Prisma.TransactionClient, id: string, name: string) {
  if (id) {
    return tx.cPEModel.findUnique({
      where: { id },
      select: { id: true, name: true, description: true },
    })
  }

  const normalizedName = normalizeHeader(name)
  if (!normalizedName) return null

  const models = await tx.cPEModel.findMany({
    select: { id: true, name: true, description: true },
  })
  return models.find((model) => normalizeHeader(model.name) === normalizedName) ?? null
}

async function findCto(tx: Prisma.TransactionClient, input: { id: string; hubsoftId: string; name: string }) {
  if (input.id) {
    return tx.cTO.findUnique({ where: { id: input.id } })
  }

  if (input.hubsoftId) {
    return tx.cTO.findUnique({ where: { hubsoftId: input.hubsoftId } })
  }

  const normalizedName = normalizeHeader(input.name)
  if (!normalizedName) return null

  const ctos = await tx.cTO.findMany()
  return ctos.find((cto) => normalizeHeader(cto.name) === normalizedName) ?? null
}

async function findCtoByOltPosition(tx: Prisma.TransactionClient, input: { host: string; port: OltPortPosition | null }) {
  if (!input.host || !input.port) return null

  const rows = await tx.$queryRaw<ImportCtoRow[]>`
    SELECT "id", "name", "address", "lat", "lng"
    FROM "CTO"
    WHERE "oltIpv4" = ${input.host}
      AND "oltChassi" = ${input.port.chassi}
      AND "oltSlot" = ${input.port.slot}
      AND "oltPon" = ${input.port.pon}
    ORDER BY "name" ASC
    LIMIT 1
  `

  return rows[0] ?? null
}

async function findOltInterfaceForCto(tx: Prisma.TransactionClient, ctoId: string) {
  const rows = await tx.$queryRaw<ImportOltInterface[]>`
    SELECT
      "OltInterface"."id",
      "OltInterface"."oltDeviceId",
      "OltInterface"."chassi",
      "OltInterface"."slot",
      "OltInterface"."pon"
    FROM "CTO"
    INNER JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
    WHERE "CTO"."id" = ${ctoId}
    LIMIT 1
  `

  return rows[0] ?? null
}

async function findOltPositionTarget(tx: Prisma.TransactionClient, input: {
  ctoId: string
  oltHost: string
  oltPortPosition: OltPortPosition | null
}) {
  if (input.oltHost && input.oltPortPosition) {
    const rows = await tx.$queryRaw<Array<{ oltDeviceId: string }>>`
      SELECT "OltDevice"."id" AS "oltDeviceId"
      FROM "OltDevice"
      LEFT JOIN "OltInterface"
        ON "OltInterface"."oltDeviceId" = "OltDevice"."id"
        AND "OltInterface"."chassi" = ${input.oltPortPosition.chassi}
        AND "OltInterface"."slot" = ${input.oltPortPosition.slot}
        AND "OltInterface"."pon" = ${input.oltPortPosition.pon}
      WHERE (
        "OltDevice"."host" = ${input.oltHost}
        OR "OltDevice"."ipv4" = ${input.oltHost}
      )
      ORDER BY
        CASE WHEN "OltInterface"."id" IS NULL THEN 1 ELSE 0 END ASC,
        "OltDevice"."isDefault" DESC,
        "OltDevice"."name" ASC
      LIMIT 1
    `

    const oltDevice = rows[0]
    if (oltDevice) {
      return {
        oltDeviceId: oltDevice.oltDeviceId,
        chassi: input.oltPortPosition.chassi,
        slot: input.oltPortPosition.slot,
        pon: input.oltPortPosition.pon,
      } satisfies ImportOltPositionTarget
    }
  }

  const linkedInterface = await findOltInterfaceForCto(tx, input.ctoId)
  if (!linkedInterface) {
    return null
  }

  return {
    oltDeviceId: linkedInterface.oltDeviceId,
    chassi: linkedInterface.chassi,
    slot: linkedInterface.slot,
    pon: linkedInterface.pon,
  } satisfies ImportOltPositionTarget
}

async function findExistingProvisioningBySerial(tx: Prisma.TransactionClient, serial: string) {
  const rows = await tx.$queryRaw<Array<{
    id: string
    portId: string
    ctoId: string
    contractNumber: string
    status: string
  }>>`
    SELECT
      "Provisioning"."id",
      "Provisioning"."portId",
      "Port"."ctoId",
      "Contract"."contractNumber",
      "Provisioning"."status"
    FROM "Provisioning"
    INNER JOIN "Port" ON "Port"."id" = "Provisioning"."portId"
    INNER JOIN "Contract" ON "Contract"."id" = "Provisioning"."contractId"
    WHERE lower("Provisioning"."serial") = lower(${serial})
      AND "Provisioning"."status" <> 'inactive'
    LIMIT 1
  `

  return rows[0] ?? null
}

async function findAvailableCtoPort(tx: Prisma.TransactionClient, ctoId: string, reservedPortIds: Set<string>) {
  return tx.port.findFirst({
    where: {
      ctoId,
      status: 'available',
      id: reservedPortIds.size > 0 ? { notIn: Array.from(reservedPortIds) } : undefined,
    },
    orderBy: { number: 'asc' },
    include: { cto: true },
  })
}

async function ctoPortOccupation(tx: Prisma.TransactionClient, ctoId: string, reservedPortIds: Set<string>) {
  const rows = await tx.port.findMany({
    where: { ctoId },
    select: { id: true, status: true },
  })

  const available = rows.filter((port) => port.status === 'available' && !reservedPortIds.has(port.id)).length
  return {
    total: rows.length,
    available,
    occupied: rows.length - available,
    reservedInCurrentCsv: rows.filter((port) => reservedPortIds.has(port.id)).length,
  }
}

async function updateLocalCtoOccupation(tx: Prisma.TransactionClient, ctoId: string) {
  const rows = await tx.port.findMany({
    where: { ctoId },
    select: { status: true },
  })
  const total = rows.length
  const available = rows.filter((port) => port.status === 'available').length
  const used = total - available

  await tx.$executeRaw`
    UPDATE "CTO"
    SET
      "hubsoftPortsTotal" = ${total},
      "hubsoftPortsAvailable" = ${available},
      "hubsoftPortsLinked" = ${used},
      "hubsoftPortsReserved" = 0,
      "hubsoftLastOccupationSync" = CURRENT_TIMESTAMP
    WHERE "id" = ${ctoId}
  `
}

async function linkImportedOnuBySerial(input: ImportedOnuLookup & { provisioningId: string }) {
  const device = await getOltDeviceConnectionById(input.oltId)
  if (!device) {
    await createProvisioningLog(prisma, {
      provisioningId: input.provisioningId,
      level: 'warn',
      stage: 'import.csv.onu_lookup_device_missing',
      message: 'Importacao concluida, mas a OLT informada no CSV nao esta cadastrada/ativa para consulta por serial.',
      details: input,
    })
    return null
  }

  await createProvisioningLog(prisma, {
    provisioningId: input.provisioningId,
    stage: 'import.csv.onu_lookup_started',
    message: 'Consultando ONU/CPE importada por serial na OLT.',
    details: {
      serial: input.serial,
      oltDevice: device.name,
      expectedPosition: {
        chassi: input.expectedChassi,
        slot: input.expectedSlot,
        pon: input.expectedPon,
      },
    },
  })

  const lookup = await queryOltOnuBySerial(device, input.serial)
  const matchedPosition = lookup.matchedPosition
    ? {
        oltDeviceId: input.oltId,
        chassi: lookup.matchedPosition.chassi,
        slot: lookup.matchedPosition.slot,
        pon: lookup.matchedPosition.pon,
        onuId: lookup.matchedPosition.onuId,
      }
    : null

  if (!lookup.isRecognizedOutput) {
    await createProvisioningLog(prisma, {
      provisioningId: input.provisioningId,
      level: 'warn',
      stage: 'import.csv.onu_lookup_unrecognized',
      message: 'A OLT nao retornou uma resposta reconhecida para localizar a ONU/CPE importada por serial.',
      details: {
        command: lookup.command,
        serial: input.serial,
        oltDevice: device.name,
        output: lookup.output.slice(-2000),
      },
    })
    return null
  }

  if (!lookup.exists || !matchedPosition) {
    await createProvisioningLog(prisma, {
      provisioningId: input.provisioningId,
      level: 'warn',
      stage: 'import.csv.onu_lookup_not_found',
      message: 'ONU/CPE importada nao foi encontrada na OLT pelo serial informado.',
      details: {
        command: lookup.command,
        serial: input.serial,
        oltDevice: device.name,
        matchedLines: lookup.matchedLines,
      },
    })
    return null
  }

  const matchesExpectedPort =
    matchedPosition.chassi === input.expectedChassi
    && matchedPosition.slot === input.expectedSlot
    && matchedPosition.pon === input.expectedPon

  if (!matchesExpectedPort) {
    await createProvisioningLog(prisma, {
      provisioningId: input.provisioningId,
      level: 'warn',
      stage: 'import.csv.onu_lookup_port_mismatch',
      message: 'ONU/CPE encontrada pelo serial, mas em uma porta OLT diferente da informada no CSV. Vinculo nao criado automaticamente.',
      details: {
        command: lookup.command,
        serial: input.serial,
        oltDevice: device.name,
        expectedPosition: {
          chassi: input.expectedChassi,
          slot: input.expectedSlot,
          pon: input.expectedPon,
        },
        matchedPosition,
        matchedLines: lookup.matchedLines,
      },
    })
    return null
  }

  const onuAccess = {
    userId: input.userId,
    oltId: input.oltId,
    ponIndex: portToPonIndex(`${matchedPosition.chassi}/${matchedPosition.slot}/${matchedPosition.pon}`),
    onuId: matchedPosition.onuId,
  } satisfies OnuAccessGrant

  await createProvisioningLog(prisma, {
    provisioningId: input.provisioningId,
    level: 'success',
    stage: 'import.csv.onu_lookup_matched',
    message: 'ONU/CPE importada localizada na OLT pelo serial e vinculada ao provisionamento.',
    details: {
      command: lookup.command,
      serial: input.serial,
      oltDevice: device.name,
      matchedPosition,
      matchedLines: lookup.matchedLines,
    },
  })

  return onuAccess
}

async function importRecord(input: {
  tx: Prisma.TransactionClient
  currentUser: { id: string; email: string; name: string | null; role: string }
  baseLandlordId: string
  dryRun: boolean
  reservedPortIds: Set<string>
  getValue: ReturnType<typeof buildAccessor>
  record: CsvRecord
}) {
  const { tx, currentUser, baseLandlordId, dryRun, reservedPortIds, getValue, record } = input
  const row = record.values
  const clientName = getValue(row, COLUMN_ALIASES.clientName)
  const contractNumber = getValue(row, COLUMN_ALIASES.contractNumber)
  const cleanCep = getValue(row, COLUMN_ALIASES.cep).replace(/\D/g, '')
  const address = getValue(row, COLUMN_ALIASES.address)
  const number = getValue(row, COLUMN_ALIASES.number)
  const complement = getValue(row, COLUMN_ALIASES.complement)
  const reference = getValue(row, COLUMN_ALIASES.reference)
  const serial = getValue(row, COLUMN_ALIASES.serial).toUpperCase()
  const cpeModelName = getValue(row, COLUMN_ALIASES.cpeModel)
  const cpeModelId = getValue(row, COLUMN_ALIASES.cpeModelId)
  const oltHost = getValue(row, COLUMN_ALIASES.oltHost)
  const oltPort = getValue(row, COLUMN_ALIASES.oltPort)
  const oltPortPosition = parseOltPort(oltPort)
  const status = normalizeStatus(getValue(row, COLUMN_ALIASES.status))
  const signal = parseInteger(getValue(row, COLUMN_ALIASES.signal))
  const activatedAt = parseDate(getValue(row, COLUMN_ALIASES.activatedAt))
  const onuId = parseInteger(getValue(row, COLUMN_ALIASES.onuId))

  if (!clientName || !contractNumber || !cleanCep || !address || !number || !serial) {
    throw new Error('Preencha cliente, contrato, CEP, endereco, numero e serial.')
  }

  if (cleanCep.length !== 8) {
    throw new Error('CEP invalido. Informe 8 digitos.')
  }

  const cpeModel = await findCpeModel(tx, cpeModelId, cpeModelName)
  if (!cpeModel) {
    throw new Error(`Modelo de CPE nao encontrado: ${cpeModelName || cpeModelId || 'vazio'}.`)
  }

  let port = null
  let resolvedCto: ImportCtoRow | Awaited<ReturnType<typeof findCto>> | null = null
  const portId = getValue(row, COLUMN_ALIASES.portId)
  if (portId) {
    port = await tx.port.findUnique({
      where: { id: portId },
      include: { cto: true },
    })
    resolvedCto = port?.cto ?? null
  } else {
    const ctoByName = await findCto(tx, {
      id: getValue(row, COLUMN_ALIASES.ctoId),
      hubsoftId: getValue(row, COLUMN_ALIASES.ctoHubsoftId),
      name: getValue(row, COLUMN_ALIASES.ctoName),
    })
    const cto = ctoByName ?? await findCtoByOltPosition(tx, { host: oltHost, port: oltPortPosition })
    resolvedCto = cto
    if (!cto) {
      throw new ImportRowError(
        `CTO nao encontrada para "${getValue(row, COLUMN_ALIASES.ctoName) || '-'}"${oltHost || oltPort ? ` na OLT ${oltHost || '-'} porta ${oltPort || '-'}` : ''}.`,
        { contractNumber, serial, oltPort },
      )
    }

    const existingBySerial = await findExistingProvisioningBySerial(tx, serial)
    if (existingBySerial && existingBySerial.ctoId !== cto.id) {
      throw new ImportRowError(`Serial ja vinculado ao contrato ${existingBySerial.contractNumber}.`, {
        contractNumber,
        serial,
        ctoName: cto.name,
        oltPort,
      })
    }

    const ctoPortNumber = parseInteger(getValue(row, COLUMN_ALIASES.ctoPortNumber))
    port = existingBySerial
      ? await tx.port.findUnique({ where: { id: existingBySerial.portId }, include: { cto: true } })
      : ctoPortNumber
        ? await tx.port.findFirst({
            where: { ctoId: cto.id, number: ctoPortNumber },
            include: { cto: true },
          })
        : await findAvailableCtoPort(tx, cto.id, dryRun ? reservedPortIds : new Set())
  }

  if (!port) {
    const ctoName = resolvedCto?.name || getValue(row, COLUMN_ALIASES.ctoName) || 'CTO nao identificada'
    const occupation = resolvedCto?.id
      ? await ctoPortOccupation(tx, resolvedCto.id, dryRun ? reservedPortIds : new Set())
      : null
    const occupationText = occupation
      ? ` Ocupacao local: ${occupation.occupied}/${occupation.total}, livres: ${occupation.available}${occupation.reservedInCurrentCsv ? `, reservadas nesta validacao: ${occupation.reservedInCurrentCsv}` : ''}.`
      : ''
    throw new ImportRowError(
      `Sem porta livre na CTO ${ctoName} para ocupar automaticamente.${occupationText}`,
      {
        contractNumber,
        serial,
        ctoName,
        oltPort,
      },
    )
  }

  const lat = parseNumber(getValue(row, COLUMN_ALIASES.lat)) ?? port.cto.lat
  const lng = parseNumber(getValue(row, COLUMN_ALIASES.lng)) ?? port.cto.lng

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Latitude e longitude invalidas.')
  }

  const oltPositionTarget = await findOltPositionTarget(tx, {
    ctoId: port.ctoId,
    oltHost,
    oltPortPosition,
  })

  const landlordId = await resolveImportLandlord(
    tx,
    currentUser,
    baseLandlordId,
    getValue(row, COLUMN_ALIASES.operatorEmail),
    dryRun,
  )

  const existingContract = await tx.contract.findUnique({
    where: { contractNumber },
    include: { landlord: true },
  })

  if (existingContract && existingContract.landlordId !== landlordId && currentUser.role !== 'admin') {
    throw new Error('Ja existe contrato com este numero para outro operador.')
  }

  const existingByPort = await tx.provisioning.findUnique({
    where: { portId: port.id },
    include: {
      contract: true,
      cpeModel: {
        select: { id: true, name: true, description: true },
      },
    },
  })

  const duplicateSerial = await findExistingProvisioningBySerial(tx, serial)

  if (duplicateSerial && duplicateSerial.portId !== port.id) {
    throw new ImportRowError(`Serial ja vinculado ao contrato ${duplicateSerial.contractNumber}.`, {
      contractNumber,
      serial,
      ctoName: port.cto.name,
      portNumber: port.number,
      oltPort,
    })
  }

  if (
    existingByPort
    && existingByPort.status !== 'inactive'
    && (
      existingByPort.contract.contractNumber !== contractNumber
      || existingByPort.serial.toLowerCase() !== serial.toLowerCase()
    )
  ) {
    throw new ImportRowError(`Porta ${port.number} da CTO ${port.cto.name} ja possui provisionamento ativo no contrato ${existingByPort.contract.contractNumber}.`, {
      contractNumber,
      serial,
      ctoName: port.cto.name,
      portNumber: port.number,
      oltPort,
    })
  }

  if (!existingByPort && port.status !== 'available') {
    throw new ImportRowError(`Porta ${port.number} da CTO ${port.cto.name} nao esta disponivel para ocupacao. Status local: ${port.status}.`, {
      contractNumber,
      serial,
      ctoName: port.cto.name,
      portNumber: port.number,
      oltPort,
    })
  }

  if (dryRun) {
    return {
      status: 'valid' as const,
      message: `Linha valida. A ocupacao da CTO sera preenchida na porta ${port.number}.`,
      contractNumber,
      serial,
      ctoName: port.cto.name,
      portNumber: port.number,
      resolvedPortId: port.id,
      oltPort,
    }
  }

  const contract = existingContract
    ? await tx.contract.update({
        where: { id: existingContract.id },
        data: {
          name: clientName,
          cep: cleanCep,
          address,
          number,
          complement: optionalText(complement),
          reference: optionalText(reference),
          lat,
          lng,
        },
      })
    : await tx.contract.create({
        data: {
          name: clientName,
          contractNumber,
          cep: cleanCep,
          address,
          number,
          complement: optionalText(complement),
          reference: optionalText(reference),
          lat,
          lng,
          landlordId,
        },
      })

  if (
    existingByPort
    && existingByPort.contract.contractNumber === contractNumber
    && existingByPort.serial.toLowerCase() === serial.toLowerCase()
    && existingByPort.status === status
  ) {
    const contractLandlord = await tx.landlord.findUnique({ where: { id: contract.landlordId } })
    const lookupUserId = contractLandlord?.userId ?? currentUser.id
    const onuLookup = oltPositionTarget
      ? {
          userId: lookupUserId,
          oltId: oltPositionTarget.oltDeviceId,
          serial,
          expectedChassi: oltPositionTarget.chassi,
          expectedSlot: oltPositionTarget.slot,
          expectedPon: oltPositionTarget.pon,
        } satisfies ImportedOnuLookup
      : null
    const onuAccess = onuId && oltPositionTarget
      ? {
          userId: lookupUserId,
          oltId: oltPositionTarget.oltDeviceId,
          ponIndex: portToPonIndex(`${oltPositionTarget.chassi}/${oltPositionTarget.slot}/${oltPositionTarget.pon}`),
          onuId,
        } satisfies OnuAccessGrant
      : null

    await createProvisioningLog(tx, {
      provisioningId: existingByPort.id,
      level: 'info',
      stage: 'import.csv.skipped',
      message: 'Linha do CSV ignorada porque o provisionamento ja estava sincronizado.',
      details: {
        line: record.line,
        contractNumber,
        serial,
        cto: port.cto.name,
        port: port.number,
        oltHost,
        oltPort,
        onuId,
        oltDeviceId: oltPositionTarget?.oltDeviceId ?? null,
        matchedPosition: onuId && oltPositionTarget
          ? {
              oltDeviceId: oltPositionTarget.oltDeviceId,
              chassi: oltPositionTarget.chassi,
              slot: oltPositionTarget.slot,
              pon: oltPositionTarget.pon,
              onuId,
            }
          : null,
      },
    })
    return {
      status: 'skipped' as const,
      message: 'Provisionamento ja existia com os mesmos dados.',
      contractNumber,
      serial,
      provisioningId: existingByPort.id,
      ctoName: port.cto.name,
      portNumber: port.number,
      oltPort,
      onuAccess,
      onuLookup,
    }
  }

  const provisioning = existingByPort
    ? await tx.provisioning.update({
        where: { id: existingByPort.id },
        data: {
          contractId: contract.id,
          cpeModelId: cpeModel.id,
          serial,
          status,
          signal,
        },
      })
    : await tx.provisioning.create({
        data: {
          contractId: contract.id,
          portId: port.id,
          cpeModelId: cpeModel.id,
          serial,
          status,
          signal,
        },
      })

  await tx.port.update({
    where: { id: port.id },
    data: { status: status === 'inactive' ? 'available' : 'provisioned' },
  })
  await updateLocalCtoOccupation(tx, port.ctoId)

  await createProvisioningLog(tx, {
    provisioningId: provisioning.id,
    level: 'success',
    stage: 'import.csv.created',
    message: existingByPort
      ? 'Provisionamento atualizado a partir da importacao CSV.'
      : 'Provisionamento importado de registro manual na OLT.',
    details: {
      line: record.line,
      contractNumber,
      serial,
      cto: port.cto.name,
      port: port.number,
      oltHost,
      oltPort,
      onuId,
      oltDeviceId: oltPositionTarget?.oltDeviceId ?? null,
      matchedPosition: onuId && oltPositionTarget
        ? {
            oltDeviceId: oltPositionTarget.oltDeviceId,
            chassi: oltPositionTarget.chassi,
            slot: oltPositionTarget.slot,
            pon: oltPositionTarget.pon,
            onuId,
          }
        : null,
      status,
    },
  })

  const contractLandlord = await tx.landlord.findUnique({ where: { id: contract.landlordId } })
  const lookupUserId = contractLandlord?.userId ?? currentUser.id
  const onuLookup = oltPositionTarget
    ? {
        userId: lookupUserId,
        oltId: oltPositionTarget.oltDeviceId,
        serial,
        expectedChassi: oltPositionTarget.chassi,
        expectedSlot: oltPositionTarget.slot,
        expectedPon: oltPositionTarget.pon,
      } satisfies ImportedOnuLookup
    : null
  const onuAccess = onuId && oltPositionTarget
    ? {
        userId: lookupUserId,
        oltId: oltPositionTarget.oltDeviceId,
        ponIndex: portToPonIndex(`${oltPositionTarget.chassi}/${oltPositionTarget.slot}/${oltPositionTarget.pon}`),
        onuId,
      } satisfies OnuAccessGrant
    : null

  return {
    status: existingByPort ? 'updated' as const : 'imported' as const,
    message: existingByPort ? 'Provisionamento atualizado.' : 'Provisionamento importado.',
    contractNumber,
    serial,
    provisioningId: provisioning.id,
    ctoName: port.cto.name,
    portNumber: port.number,
    oltPort,
    activatedAt,
    onuAccess,
    onuLookup,
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return unauthorized()

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return unauthorized()

  if (user.role !== 'admin') {
    try {
      await assertPortalMutationAllowed(user.id, 'provision')
    } catch (error) {
      return NextResponse.json({
        error: 'Acesso bloqueado.',
        message: error instanceof Error ? error.message : 'Seu acesso nao permite importar provisionamentos no momento.',
      }, { status: 403 })
    }
  }

  let body: { csv?: unknown; dryRun?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido.' }, { status: 400 })
  }

  const csv = typeof body.csv === 'string' ? body.csv : ''
  const dryRun = body.dryRun === true
  if (!csv.trim()) {
    return NextResponse.json({ error: 'Envie o conteudo CSV para importar.' }, { status: 400 })
  }

  let parsed: ParsedCsv
  try {
    parsed = parseCsv(csv)
  } catch (error) {
    return NextResponse.json({
      error: 'CSV invalido.',
      message: error instanceof Error ? error.message : 'Nao foi possivel ler o arquivo.',
    }, { status: 400 })
  }

  if (parsed.headers.length === 0 || parsed.records.length === 0) {
    return NextResponse.json({ error: 'CSV sem cabecalho ou sem linhas.' }, { status: 400 })
  }

  const getValue = buildAccessor(parsed.headers)
  const results: ImportRowResult[] = []
  const dryRunReservedPortIds = new Set<string>()
  let baseLandlordId = ''

  try {
    if (dryRun) {
      const existingBaseLandlord = await prisma.landlord.findUnique({ where: { userId: user.id } })
      baseLandlordId = existingBaseLandlord?.id ?? `dry-run:${user.id}`
    } else {
      const baseLandlord = await prisma.$transaction((tx) => ensureLandlordForUser(tx, user))
      baseLandlordId = baseLandlord.id
    }
  } catch (error) {
    return NextResponse.json({
      error: 'Falha ao preparar operador.',
      message: error instanceof Error ? error.message : 'Nao foi possivel preparar o operador.',
    }, { status: 500 })
  }

  for (const record of parsed.records) {
    try {
      const result = await prisma.$transaction((tx) => importRecord({
        tx,
        currentUser: user,
        baseLandlordId,
        dryRun,
        reservedPortIds: dryRunReservedPortIds,
        getValue,
        record,
      }))
      if (dryRun && 'resolvedPortId' in result && result.resolvedPortId) {
        dryRunReservedPortIds.add(result.resolvedPortId)
      }

      if (!dryRun && result.provisioningId) {
        let onuAccess = 'onuAccess' in result ? result.onuAccess : null
        if ('onuLookup' in result && result.onuLookup) {
          onuAccess = null
          try {
            onuAccess = await linkImportedOnuBySerial({
              provisioningId: result.provisioningId,
              ...result.onuLookup,
            }) ?? onuAccess
          } catch (onuLookupError) {
            await createProvisioningLog(prisma, {
              provisioningId: result.provisioningId,
              level: 'warn',
              stage: 'import.csv.onu_lookup_failed',
              message: 'Importacao concluida, mas houve falha ao consultar a ONU na OLT pelo serial.',
              details: {
                error: onuLookupError instanceof Error ? onuLookupError.message : String(onuLookupError),
                onuLookup: result.onuLookup,
              },
            })
          }
        }

        if (onuAccess) {
          try {
            await grantOperatorOnuAccess(onuAccess)
          } catch (onuAccessError) {
            await createProvisioningLog(prisma, {
              provisioningId: result.provisioningId,
              level: 'warn',
              stage: 'import.csv.onu_access_failed',
              message: 'Importacao concluida, mas o vinculo de monitoramento da ONU nao foi criado automaticamente.',
              details: {
                error: onuAccessError instanceof Error ? onuAccessError.message : String(onuAccessError),
                onuAccess,
              },
            })
          }
        }
      }

      if (!dryRun && result.provisioningId && result.status !== 'skipped') {
        try {
          await activateBillingServiceForProvisioning(result.provisioningId, 'activatedAt' in result ? result.activatedAt : new Date())
        } catch (billingError) {
          await createProvisioningLog(prisma, {
            provisioningId: result.provisioningId,
            level: 'warn',
            stage: 'import.csv.billing_failed',
            message: 'Importacao concluida, mas o servico financeiro nao foi ativado automaticamente.',
            details: {
              error: billingError instanceof Error ? billingError.message : String(billingError),
            },
          })
        }
      }

      results.push({
        line: record.line,
        status: result.status,
        message: result.message,
        contractNumber: result.contractNumber,
        serial: result.serial,
        provisioningId: result.provisioningId,
        ctoName: result.ctoName,
        portNumber: result.portNumber,
        oltPort: result.oltPort,
      })
    } catch (error) {
      const rowDetails = error instanceof ImportRowError ? error.rowDetails : {}
      results.push({
        line: record.line,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Falha ao importar linha.',
        contractNumber: rowDetails.contractNumber,
        serial: rowDetails.serial,
        ctoName: rowDetails.ctoName,
        portNumber: rowDetails.portNumber,
        oltPort: rowDetails.oltPort,
      })
    }
  }

  const summary = results.reduce(
    (acc, result) => {
      acc.total += 1
      if (result.status === 'imported') acc.imported += 1
      if (result.status === 'updated') acc.updated += 1
      if (result.status === 'skipped') acc.skipped += 1
      if (result.status === 'valid') acc.valid += 1
      if (result.status === 'failed') acc.failed += 1
      return acc
    },
    { total: 0, imported: 0, updated: 0, skipped: 0, valid: 0, failed: 0 },
  )

  return NextResponse.json({ dryRun, summary, results })
}
