export type HubsoftPort = {
  id: string
  number: number
  status: 'available' | 'provisioned' | string
  reserved: boolean
  reference: string | null
  hasClientService: boolean
  rawStatus: 'available' | 'reserved' | 'linked'
}

export type HubsoftOltInterface = {
  hubsoftInterfaceId: string | null
  name: string
  description: string | null
  type: string
  display: string | null
  hubsoftOltDeviceId: string | null
  oltName: string | null
  oltIpv4: string | null
  manufacturer: string | null
  model: string | null
  vlan: number | null
  chassi: number | null
  slot: number | null
  pon: number | null
  requireCtoLink: boolean
  blockOverutilization: boolean
  alarmSubscriberSignal: number | null
  alarmEquipmentSignal: number | null
  identifier: string | null
}

export type HubsoftCTO = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  ports: HubsoftPort[]
  oltInterface: HubsoftOltInterface | null
  occupation?: {
    total: number
    reserved: number
    linked: number
    available: number
    used: number
  }
}

export type HubsoftClientService = {
  idClienteServico: string
  uuidClienteServico: string | null
  idServico: string | null
  name: string
  value: number | null
  status: string | null
  statusPrefix: string | null
  technology: string | null
  downloadSpeed: string | null
  uploadSpeed: string | null
  authenticationId: string | null
  login: string | null
  ipv4: string | null
  ipv6: string | null
  macAddress: string | null
  phyAddress: string | null
  vlan: number | null
  enabledAt: string | null
  contractStartedAt: string | null
  contractEndsAt: string | null
  raw: Record<string, unknown>
}

export type HubsoftClient = {
  idCliente: string
  uuidCliente: string | null
  codigoCliente: number | null
  legalName: string
  tradeName: string | null
  personType: string | null
  cnpj: string
  primaryPhone: string | null
  secondaryPhone: string | null
  primaryEmail: string | null
  municipalRegistration: string | null
  stateRegistration: string | null
  active: boolean
  origin: string | null
  registeredAt: string | null
  updatedAt: string | null
  services: HubsoftClientService[]
  raw: Record<string, unknown>
}

export type HubsoftSyncResult = {
  synced: number
  created: number
  updated: number
  portsCreated: number
  missingInHubsoft: number
  auditsCreated: number
  errors: number
}

export type HubsoftInvoice = {
  idFatura: string
  idClienteServico: string
  dueDate: string | null
  paidAt: string | null
  amount: number | null
  paidAmount: number | null
  status: string
  link: string | null
  raw: Record<string, unknown>
}

const HUBSOFT_API_URL = process.env.HUBSOFT_API_URL
const HUBSOFT_API_TOKEN = process.env.HUBSOFT_API_TOKEN
const HUBSOFT_CLIENT_ID = process.env.HUBSOFT_CLIENT_ID
const HUBSOFT_CLIENT_SECRET = process.env.HUBSOFT_CLIENT_SECRET
const HUBSOFT_USERNAME = process.env.HUBSOFT_USERNAME
const HUBSOFT_PASSWORD = process.env.HUBSOFT_PASSWORD
const HUBSOFT_OAUTH_PATH = process.env.HUBSOFT_OAUTH_PATH || '/oauth/token'
const HUBSOFT_PROJECT_ID = process.env.HUBSOFT_PROJECT_ID || process.env.id_projeto
const HUBSOFT_EMENDA = process.env.emenda || 'nao'
const HUBSOFT_ATENDIMENTO = process.env.atendimento || 'sim'

const SYNC_STATUS_SYNCED = 'synced'
const SYNC_STATUS_ERROR = 'error'
const SYNC_STATUS_MISSING_IN_HUBSOFT = 'missing_in_hubsoft'

let hubsoftOccupationSchemaReady: Promise<void> | null = null

function createAuditId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function formatHubsoftDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthsBefore(date: Date, months: number) {
  const target = new Date(date.getFullYear(), date.getMonth() - months, 1)
  const lastDayOfTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDayOfTargetMonth))
  return target
}

function hubsoftInvoiceSearchStartDate(date = new Date()) {
  return formatHubsoftDate(monthsBefore(date, 6))
}

function createLocalId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function textValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const text = String(value).trim()
  return text || null
}

function numberValue(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

async function ensureHubsoftOccupationSchema() {
  hubsoftOccupationSchemaReady ??= (async () => {
    const { prisma } = await import('@/lib/prisma')
    const ctoColumns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("CTO")`
    const portColumns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("Port")`
    const ctoColumnNames = new Set(ctoColumns.map((column) => column.name))
    const portColumnNames = new Set(portColumns.map((column) => column.name))

    if (!ctoColumnNames.has('hubsoftPortsTotal')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsTotal" INTEGER NOT NULL DEFAULT 0')
    }
    if (!ctoColumnNames.has('hubsoftPortsReserved')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsReserved" INTEGER NOT NULL DEFAULT 0')
    }
    if (!ctoColumnNames.has('hubsoftPortsLinked')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsLinked" INTEGER NOT NULL DEFAULT 0')
    }
    if (!ctoColumnNames.has('hubsoftPortsAvailable')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "CTO" ADD COLUMN "hubsoftPortsAvailable" INTEGER NOT NULL DEFAULT 0')
    }
    if (!ctoColumnNames.has('hubsoftLastOccupationSync')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "CTO" ADD COLUMN "hubsoftLastOccupationSync" DATETIME')
    }

    if (!portColumnNames.has('hubsoftId')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Port" ADD COLUMN "hubsoftId" TEXT')
    }
    if (!portColumnNames.has('hubsoftReserved')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Port" ADD COLUMN "hubsoftReserved" BOOLEAN NOT NULL DEFAULT false')
    }
    if (!portColumnNames.has('hubsoftReference')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Port" ADD COLUMN "hubsoftReference" TEXT')
    }
    if (!portColumnNames.has('hubsoftHasClientService')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Port" ADD COLUMN "hubsoftHasClientService" BOOLEAN NOT NULL DEFAULT false')
    }
    if (!portColumnNames.has('hubsoftRawStatus')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Port" ADD COLUMN "hubsoftRawStatus" TEXT')
    }
    if (!portColumnNames.has('hubsoftLastSync')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Port" ADD COLUMN "hubsoftLastSync" DATETIME')
    }

    const indexes = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA index_list("Port")`
    const indexNames = new Set(indexes.map((index) => index.name))
    if (!indexNames.has('Port_hubsoftId_key')) {
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX "Port_hubsoftId_key" ON "Port"("hubsoftId")')
    }
    if (!indexNames.has('Port_hubsoftId_idx')) {
      await prisma.$executeRawUnsafe('CREATE INDEX "Port_hubsoftId_idx" ON "Port"("hubsoftId")')
    }
    if (!indexNames.has('Port_hubsoftRawStatus_idx')) {
      await prisma.$executeRawUnsafe('CREATE INDEX "Port_hubsoftRawStatus_idx" ON "Port"("hubsoftRawStatus")')
    }
    if (!indexNames.has('Port_hubsoftLastSync_idx')) {
      await prisma.$executeRawUnsafe('CREATE INDEX "Port_hubsoftLastSync_idx" ON "Port"("hubsoftLastSync")')
    }
  })().catch((error) => {
    hubsoftOccupationSchemaReady = null
    throw error
  })

  return hubsoftOccupationSchemaReady
}

function hubsoftBaseUrl() {
  if (!HUBSOFT_API_URL) {
    throw new Error('HUBSOFT_API_URL is not configured')
  }

  return HUBSOFT_API_URL.replace(/\/$/, '')
}

function parseHubsoftPort(rawPort: Record<string, unknown>, fallbackIndex: number): HubsoftPort {
  const hubsoftId = textValue(rawPort.id_porta_atendimento)
  if (!hubsoftId) {
    throw new Error('Hubsoft port response is malformed: missing id_porta_atendimento')
  }

  const reserved = booleanValue(rawPort.reservado)
  const hasClientService = Array.isArray(rawPort.clientes_servicos) && rawPort.clientes_servicos.length > 0
  const rawStatus = hasClientService ? 'linked' : reserved ? 'reserved' : 'available'
  const sequence = numberValue(rawPort.sequencia)

  return {
    id: hubsoftId,
    number: sequence === null ? fallbackIndex + 1 : sequence + 1,
    status: rawStatus === 'available' ? 'available' : 'provisioned',
    reserved,
    reference: textValue(rawPort.referencia),
    hasClientService,
    rawStatus,
  }
}

function parseHubsoftClientService(rawService: Record<string, unknown>): HubsoftClientService | null {
  const idClienteServico = textValue(rawService.id_cliente_servico)
  if (!idClienteServico) return null

  return {
    idClienteServico,
    uuidClienteServico: textValue(rawService.uuid_cliente_servico),
    idServico: textValue(rawService.id_servico),
    name: textValue(rawService.nome) ?? 'Servico Hubsoft',
    value: numberValue(rawService.valor),
    status: textValue(rawService.status),
    statusPrefix: textValue(rawService.status_prefixo),
    technology: textValue(rawService.tecnologia),
    downloadSpeed: textValue(rawService.velocidade_download),
    uploadSpeed: textValue(rawService.velocidade_upload),
    authenticationId: textValue(rawService.id_cliente_servico_autenticacao),
    login: textValue(rawService.login),
    ipv4: textValue(rawService.ipv4),
    ipv6: textValue(rawService.ipv6),
    macAddress: textValue(rawService.mac_addr),
    phyAddress: textValue(rawService.phy_addr),
    vlan: numberValue(rawService.vlan),
    enabledAt: textValue(rawService.data_habilitacao),
    contractStartedAt: textValue(rawService.data_inicio_contrato),
    contractEndsAt: textValue(rawService.data_fim_contrato),
    raw: rawService,
  }
}

function parseHubsoftClient(rawClient: Record<string, unknown>): HubsoftClient | null {
  const idCliente = textValue(rawClient.id_cliente)
  const cnpj = textValue(rawClient.cpf_cnpj)?.replace(/\D/g, '') ?? ''
  const legalName = textValue(rawClient.nome_razaosocial)
  if (!idCliente || !cnpj || !legalName) return null

  const rawServices = Array.isArray(rawClient.servicos) ? rawClient.servicos : []
  const services = rawServices
    .map((service) => asRecord(service))
    .filter((service): service is Record<string, unknown> => Boolean(service))
    .map(parseHubsoftClientService)
    .filter((service): service is HubsoftClientService => Boolean(service))

  return {
    idCliente,
    uuidCliente: textValue(rawClient.uuid_cliente),
    codigoCliente: numberValue(rawClient.codigo_cliente),
    legalName,
    tradeName: textValue(rawClient.nome_fantasia),
    personType: textValue(rawClient.tipo_pessoa),
    cnpj,
    primaryPhone: textValue(rawClient.telefone_primario),
    secondaryPhone: textValue(rawClient.telefone_secundario),
    primaryEmail: textValue(rawClient.email_principal),
    municipalRegistration: textValue(rawClient.inscricao_municipal),
    stateRegistration: textValue(rawClient.inscricao_estadual),
    active: booleanValue(rawClient.ativo),
    origin: textValue(rawClient.origem_cliente),
    registeredAt: textValue(rawClient.data_cadastro),
    updatedAt: textValue(rawClient.data_atualizacao),
    services,
    raw: rawClient,
  }
}

function parseHubsoftInvoice(rawInvoice: Record<string, unknown>): HubsoftInvoice | null {
  const idFatura = textValue(rawInvoice.id_fatura)
  const idClienteServico = textValue(rawInvoice.id_cliente_servico)
  if (!idFatura || !idClienteServico) return null

  const dueDate = textValue(rawInvoice.data_vencimento)
  const paidAt = textValue(rawInvoice.data_pagamento)
  const amount = numberValue(rawInvoice.valor) ?? numberValue(rawInvoice.valor_original)
  const paidAmount = numberValue(rawInvoice.valor_pago)
  const active = booleanValue(rawInvoice.fatura_ativa)
  const today = new Date()
  const due = dueDate ? new Date(`${dueDate}T23:59:59`) : null
  const status = paidAt
    ? 'paid'
    : due && due.getTime() < today.getTime()
      ? 'overdue'
      : active
        ? 'open'
        : 'inactive'

  return {
    idFatura,
    idClienteServico,
    dueDate,
    paidAt,
    amount,
    paidAmount,
    status,
    link: textValue(rawInvoice.link),
    raw: rawInvoice,
  }
}

function parseHubsoftCto(rawCaixa: Record<string, unknown>): HubsoftCTO {
  const rawPortas = Array.isArray(rawCaixa.portas) ? (rawCaixa.portas as Array<Record<string, unknown>>) : []
  const ports = rawPortas.map((porta, index) => parseHubsoftPort(porta, index))
  const total = numberValue(rawCaixa.portas_total) ?? ports.length
  const reserved = numberValue(rawCaixa.portas_reservadas) ?? ports.filter((port) => port.rawStatus === 'reserved').length
  const linked = numberValue(rawCaixa.portas_vinculadas) ?? ports.filter((port) => port.rawStatus === 'linked').length
  const available = numberValue(rawCaixa.portas_disponiveis) ?? ports.filter((port) => port.rawStatus === 'available').length
  const pontoJuncao = rawCaixa.ponto_juncao as Record<string, unknown> | undefined
  const oltInterface = parseHubsoftOltInterface(rawCaixa.interfaces)

  return {
    id: String(rawCaixa.id_caixa_optica),
    name: String(rawCaixa.nome ?? rawCaixa.display ?? ''),
    address: String(rawCaixa.observacao ?? ''),
    lat: Number(pontoJuncao?.latitude ?? 0),
    lng: Number(pontoJuncao?.longitude ?? 0),
    ports,
    oltInterface,
    occupation: {
      total,
      reserved,
      linked,
      available,
      used: reserved + linked,
    },
  }
}

async function updateHubsoftCtoOccupationCache(cto: HubsoftCTO) {
  const { prisma } = await import('@/lib/prisma')
  await ensureHubsoftOccupationSchema()

  await prisma.$executeRaw`
    UPDATE "CTO"
    SET
      "hubsoftPortsTotal" = ${cto.occupation?.total ?? cto.ports.length},
      "hubsoftPortsReserved" = ${cto.occupation?.reserved ?? cto.ports.filter((port) => port.rawStatus === 'reserved').length},
      "hubsoftPortsLinked" = ${cto.occupation?.linked ?? cto.ports.filter((port) => port.rawStatus === 'linked').length},
      "hubsoftPortsAvailable" = ${cto.occupation?.available ?? cto.ports.filter((port) => port.rawStatus === 'available').length},
      "hubsoftLastOccupationSync" = ${new Date()}
    WHERE "hubsoftId" = ${cto.id}
  `
}

async function upsertHubsoftCtoCoreCache(cto: HubsoftCTO, syncStatus = SYNC_STATUS_SYNCED) {
  const { prisma } = await import('@/lib/prisma')
  const existingCto = await prisma.cTO.findUnique({ where: { hubsoftId: cto.id } })
  const now = new Date()

  if (existingCto) {
    const updatedCto = await prisma.cTO.update({
      where: { id: existingCto.id },
      data: {
        name: cto.name,
        address: cto.address,
        lat: cto.lat,
        lng: cto.lng,
        lastSync: now,
        syncStatus,
        syncError: null,
      },
    })
    await prisma.$executeRaw`UPDATE "CTO" SET "hubsoftDeletedAt" = NULL WHERE "id" = ${updatedCto.id}`
    return updatedCto
  }

  return prisma.cTO.create({
    data: {
      hubsoftId: cto.id,
      name: cto.name,
      address: cto.address,
      lat: cto.lat,
      lng: cto.lng,
      lastSync: now,
      syncStatus,
    },
  })
}

async function updateHubsoftPortCache(cto: HubsoftCTO, port: HubsoftPort) {
  const { prisma } = await import('@/lib/prisma')
  await ensureHubsoftOccupationSchema()
  const existingPorts = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Port"
    WHERE "hubsoftId" = ${port.id} OR "id" = ${port.id}
    LIMIT 1
  `
  const existingPort = existingPorts[0] ?? null

  if (existingPort) {
    await prisma.$executeRaw`
      UPDATE "Port"
      SET
        "hubsoftId" = ${port.id},
        "number" = ${port.number},
        "status" = ${port.status},
        "hubsoftReserved" = ${port.reserved},
        "hubsoftReference" = ${port.reference},
        "hubsoftHasClientService" = ${port.hasClientService},
        "hubsoftRawStatus" = ${port.rawStatus},
        "hubsoftLastSync" = ${new Date()}
      WHERE "id" = ${existingPort.id}
    `
  }

  await updateHubsoftCtoOccupationCache(cto)
}

async function updateHubsoftCtoCache(cto: HubsoftCTO) {
  const { prisma } = await import('@/lib/prisma')
  await ensureHubsoftOccupationSchema()
  const localCto = await upsertHubsoftCtoCoreCache(cto)

  for (const port of cto.ports) {
    const existingPorts = await prisma.$queryRaw<Array<{ id: string; provisioningId: string | null }>>`
      SELECT "Port"."id", "Provisioning"."id" AS "provisioningId"
      FROM "Port"
      LEFT JOIN "Provisioning" ON "Provisioning"."portId" = "Port"."id"
      WHERE "Port"."hubsoftId" = ${port.id} OR "Port"."id" = ${port.id}
      LIMIT 1
    `
    const existingPort = existingPorts[0] ?? null

    if (!existingPort) {
      await prisma.$executeRaw`
        INSERT INTO "Port" (
          "id",
          "hubsoftId",
          "number",
          "status",
          "ctoId",
          "hubsoftReserved",
          "hubsoftReference",
          "hubsoftHasClientService",
          "hubsoftRawStatus",
          "hubsoftLastSync"
        ) VALUES (
          ${port.id},
          ${port.id},
          ${port.number},
          ${port.status},
          ${localCto.id},
          ${port.reserved},
          ${port.reference},
          ${port.hasClientService},
          ${port.rawStatus},
          ${new Date()}
        )
      `
      continue
    }

    await prisma.$executeRaw`
      UPDATE "Port"
      SET
        "hubsoftId" = ${port.id},
        "number" = ${port.number},
        "ctoId" = CASE WHEN ${existingPort.provisioningId} IS NULL THEN ${localCto.id} ELSE "ctoId" END,
        "status" = ${port.status},
        "hubsoftReserved" = ${port.reserved},
        "hubsoftReference" = ${port.reference},
        "hubsoftHasClientService" = ${port.hasClientService},
        "hubsoftRawStatus" = ${port.rawStatus},
        "hubsoftLastSync" = ${new Date()}
      WHERE "id" = ${existingPort.id}
    `
  }

  await updateHubsoftCtoOccupationCache(cto)
}

function parseHubsoftOltInterface(rawInterfaces: unknown): HubsoftOltInterface | null {
  const interfaces = Array.isArray(rawInterfaces)
    ? rawInterfaces.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : []
  const rawInterface = interfaces.find((item) => asRecord(item.interface_x))
    ?? interfaces.find((item) => textValue(item.tipo)?.toLowerCase() === 'gpon')
    ?? interfaces[0]

  if (!rawInterface) {
    return null
  }

  const rawOlt = asRecord(rawInterface.equipamento_conexao)
  const rawModel = asRecord(rawOlt?.modelo_equipamento)
  const rawManufacturer = asRecord(rawModel?.fabricante_equipamento)
  const rawInterfaceDetails = asRecord(rawInterface.interface_x)

  return {
    hubsoftInterfaceId: textValue(rawInterface.id_interface_conexao),
    name: textValue(rawInterface.nome) ?? textValue(rawInterface.display) ?? 'Interface Hubsoft',
    description: textValue(rawInterface.descricao),
    type: (textValue(rawInterface.tipo) ?? 'GPON').toUpperCase(),
    display: textValue(rawInterface.display),
    hubsoftOltDeviceId: textValue(rawInterface.id_equipamento_conexao) ?? textValue(rawOlt?.id_equipamento_conexao),
    oltName: textValue(rawOlt?.nome) ?? textValue(rawOlt?.display),
    oltIpv4: textValue(rawOlt?.ipv4),
    manufacturer: textValue(rawManufacturer?.nome),
    model: textValue(rawModel?.nome) ?? textValue(rawModel?.display),
    vlan: numberValue(rawInterfaceDetails?.vlan),
    chassi: numberValue(rawInterfaceDetails?.chassi),
    slot: numberValue(rawInterfaceDetails?.slot),
    pon: numberValue(rawInterfaceDetails?.pon),
    requireCtoLink: booleanValue(rawInterfaceDetails?.obrigatorio_vincular_porta_atendimento),
    blockOverutilization: booleanValue(rawInterfaceDetails?.barrar_superutilizacao),
    alarmSubscriberSignal: numberValue(rawInterfaceDetails?.sinal_alarme_tx),
    alarmEquipmentSignal: numberValue(rawInterfaceDetails?.sinal_alarme_rx),
    identifier: textValue(rawInterfaceDetails?.identificador),
  }
}

function buildHubsoftCtoUrl(page: number) {
  if (!HUBSOFT_API_URL || !HUBSOFT_PROJECT_ID) {
    throw new Error('Hubsoft URL and project id are required')
  }

  const params = new URLSearchParams({
    emenda: HUBSOFT_EMENDA,
    atendimento: HUBSOFT_ATENDIMENTO,
    page: String(page),
  })

  return `${HUBSOFT_API_URL.replace(/\/$/, '')}/api/v1/integracao/mapeamento/projeto/${HUBSOFT_PROJECT_ID}/caixa_optica?${params.toString()}`
}


async function getHubsoftToken(): Promise<string> {
  if (HUBSOFT_API_TOKEN) {
    return HUBSOFT_API_TOKEN
  }

  if (!HUBSOFT_API_URL) {
    throw new Error('HUBSOFT_API_URL is not configured')
  }

  if (!HUBSOFT_CLIENT_ID || !HUBSOFT_CLIENT_SECRET || !HUBSOFT_USERNAME || !HUBSOFT_PASSWORD) {
    throw new Error('Hubsoft credentials are not fully configured')
  }

  const tokenUrl = `${HUBSOFT_API_URL.replace(/\/$/, '')}${HUBSOFT_OAUTH_PATH}`
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'password',
      client_id: HUBSOFT_CLIENT_ID,
      client_secret: HUBSOFT_CLIENT_SECRET,
      username: HUBSOFT_USERNAME,
      password: HUBSOFT_PASSWORD,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Hubsoft OAuth failed: ${response.status} ${body}`)
  }

  const data = await response.json()
  const token = data.access_token || data.token
  if (!token) {
    throw new Error('Hubsoft OAuth response did not include an access token')
  }

  return String(token)
}

async function getHubsoftHeaders() {
  const token = await getHubsoftToken()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export async function fetchHubsoftClientByCnpj(cnpj: string): Promise<HubsoftClient | null> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) {
    throw new Error('Informe um CNPJ com 14 digitos para consultar o Hubsoft.')
  }

  const params = new URLSearchParams({
    busca: 'cpf_cnpj',
    termo_busca: digits,
    inativo: 'nao',
    limit: '1',
    cancelado: 'nao',
  })

  const response = await fetch(`${hubsoftBaseUrl()}/api/v1/integracao/cliente?${params.toString()}`, {
    method: 'GET',
    headers: await getHubsoftHeaders(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Hubsoft client lookup failed: ${response.status} ${body}`)
  }

  const data = await response.json()
  const rawClient = Array.isArray(data.clientes) ? asRecord(data.clientes[0]) : null
  if (!rawClient) return null

  return parseHubsoftClient(rawClient)
}

export async function fetchHubsoftInvoicesByClientServiceId(idClienteServico: string): Promise<HubsoftInvoice[]> {
  const cleanId = textValue(idClienteServico)
  if (!cleanId) {
    throw new Error('Informe o id_cliente_servico para consultar faturas no Hubsoft.')
  }

  return fetchHubsoftInvoices(new URLSearchParams({
    busca: 'id_cliente_servico',
    termo_busca: cleanId,
  }))
}

export async function fetchHubsoftInvoicesByClientId(idCliente: string): Promise<HubsoftInvoice[]> {
  const cleanId = textValue(idCliente)
  if (!cleanId) {
    throw new Error('Informe o id_cliente para consultar faturas no Hubsoft.')
  }

  return fetchHubsoftInvoices(new URLSearchParams({
    busca: 'id_cliente',
    termo_busca: cleanId,
  }))
}

export async function fetchHubsoftInvoicesByCnpj(cnpj: string): Promise<HubsoftInvoice[]> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 11 && digits.length !== 14) {
    throw new Error('Informe um CPF ou CNPJ valido para consultar faturas no Hubsoft.')
  }

  return fetchHubsoftInvoices(new URLSearchParams({
    busca: 'cpf_cnpj',
    termo_busca: digits,
  }))
}

async function fetchHubsoftInvoices(params: URLSearchParams): Promise<HubsoftInvoice[]> {
  const headers = await getHubsoftHeaders()
  const invoices = new Map<string, HubsoftInvoice>()
  let page = 0
  let lastPage = 0

  params.set('tipo_resultado', 'simplificado')
  params.set('data_inicio', hubsoftInvoiceSearchStartDate())
  params.set('exibir_pix_copia_cola', 'sim')

  do {
    params.set('page', String(page))

    const response = await fetch(`${hubsoftBaseUrl()}/api/v1/integracao/financeiro/fatura?${params.toString()}`, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Hubsoft invoice lookup failed: ${response.status} ${body}`)
    }

    const data = await response.json()
    const rawInvoices: unknown[] = Array.isArray(data.faturas) ? data.faturas : []
    rawInvoices
      .map(asRecord)
      .filter((invoice): invoice is Record<string, unknown> => Boolean(invoice))
      .map(parseHubsoftInvoice)
      .filter((invoice): invoice is HubsoftInvoice => Boolean(invoice))
      .forEach((invoice) => {
        invoices.set(`${invoice.idFatura}:${invoice.idClienteServico}`, invoice)
      })

    const pagination = asRecord(data.paginacao)
    lastPage = numberValue(pagination?.ultima_pagina) ?? page
    page += 1
  } while (page <= lastPage && page < 100)

  return Array.from(invoices.values())
}

export async function fetchHubsoftCTOs(): Promise<HubsoftCTO[]> {
  if (!HUBSOFT_API_URL) {
    throw new Error('HUBSOFT_API_URL is not configured')
  }

  if (!HUBSOFT_PROJECT_ID) {
    throw new Error('HUBSOFT_PROJECT_ID is not configured')
  }

  const allCaixas: unknown[] = []
  let page = 1
  let hasMore = true
  const headers = await getHubsoftHeaders()

  while (hasMore) {
    const response = await fetch(buildHubsoftCtoUrl(page), {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Hubsoft request failed: ${response.status} ${body}`)
    }

    const data = await response.json()

    if (!data.caixas || !Array.isArray(data.caixas)) {
      throw new Error('Hubsoft response is malformed: missing caixas array')
    }

    allCaixas.push(...(data.caixas as unknown[]))

    // Check pagination
    if (data.paginacao) {
      const { pagina_atual, ultima_pagina } = data.paginacao
      if (pagina_atual >= ultima_pagina) {
        hasMore = false
      } else {
        page++
      }
    } else {
      hasMore = false
    }
  }

  return (allCaixas as Array<Record<string, unknown>>).map(parseHubsoftCto)
}

export async function fetchHubsoftCtoById(hubsoftCtoId: string): Promise<HubsoftCTO> {
  const params = new URLSearchParams({
    busca: 'id_caixa_optica',
    termo_busca: hubsoftCtoId,
  })
  const response = await fetch(`${hubsoftBaseUrl()}/api/v1/integracao/mapeamento/caixa_optica?${params.toString()}`, {
    method: 'GET',
    headers: await getHubsoftHeaders(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Hubsoft CTO lookup failed: ${response.status} ${body}`)
  }

  const data = await response.json()
  const rawCaixa = Array.isArray(data.caixas) ? asRecord(data.caixas[0]) : null
  if (!rawCaixa) {
    throw new Error(`Hubsoft CTO ${hubsoftCtoId} was not found`)
  }

  const cto = parseHubsoftCto(rawCaixa)
  await updateHubsoftCtoCache(cto)
  return cto
}

export function buildHubsoftProvisioningReference(input: {
  userId: string
  contractNumber: string
  provisioningId: string
  createdAt?: Date
}) {
  const date = (input.createdAt ?? new Date()).toISOString().slice(0, 10).replace(/-/g, '')
  return `USER-${input.userId}|CONTRACT-${input.contractNumber}|PROV-${input.provisioningId}|CREATED-${date}`
}

export async function validateHubsoftPortForReservation(input: {
  hubsoftCtoId: string
  hubsoftPortId: string
  expectedReference: string
}) {
  const cto = await fetchHubsoftCtoById(input.hubsoftCtoId)
  const port = cto.ports.find((item) => item.id === input.hubsoftPortId)

  if (!port) {
    throw new Error(`Porta Hubsoft ${input.hubsoftPortId} nao encontrada na CTO ${input.hubsoftCtoId}.`)
  }

  if (port.rawStatus === 'linked') {
    throw new Error(`Porta #${port.number} ja possui cliente/servico vinculado no Hubsoft.`)
  }

  if (port.rawStatus === 'reserved' && port.reference !== input.expectedReference) {
    throw new Error(`Porta #${port.number} ja esta reservada no Hubsoft para outra referencia: ${port.reference ?? 'sem referencia'}.`)
  }

  return { cto, port }
}

async function updateHubsoftPortReference(hubsoftPortId: string, reference: string | null) {
  const params = new URLSearchParams({
    id_porta_atendimento: hubsoftPortId,
    referencia: reference ?? '',
  })
  const response = await fetch(`${hubsoftBaseUrl()}/api/v1/integracao/mapeamento/projeto/porta_atendimento?${params.toString()}`, {
    method: 'PUT',
    headers: await getHubsoftHeaders(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Hubsoft port reference update failed: ${response.status} ${body}`)
  }

  return response.json()
}

async function setHubsoftPortReserved(hubsoftPortId: string, reserved: boolean, reference: string | null) {
  const params = new URLSearchParams({
    reservado: reserved ? 'true' : 'false',
  })

  if (reference) {
    params.set('observacao', reference)
  }

  const response = await fetch(`${hubsoftBaseUrl()}/api/v1/integracao/mapeamento/projeto/porta_atendimento/reservar/${encodeURIComponent(hubsoftPortId)}?${params.toString()}`, {
    method: 'PATCH',
    headers: await getHubsoftHeaders(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Hubsoft port reservation update failed: ${response.status} ${body}`)
  }

  return response.json()
}

export async function reserveHubsoftPort(input: {
  hubsoftCtoId: string
  hubsoftPortId: string
  reference: string
}) {
  await validateHubsoftPortForReservation({
    hubsoftCtoId: input.hubsoftCtoId,
    hubsoftPortId: input.hubsoftPortId,
    expectedReference: input.reference,
  })
  await updateHubsoftPortReference(input.hubsoftPortId, input.reference)
  await setHubsoftPortReserved(input.hubsoftPortId, true, input.reference)

  const cto = await fetchHubsoftCtoById(input.hubsoftCtoId)
  const port = cto.ports.find((item) => item.id === input.hubsoftPortId)
  if (!port?.reserved || port.reference !== input.reference) {
    throw new Error('Hubsoft nao confirmou a reserva da porta com a referencia esperada.')
  }

  await updateHubsoftPortCache(cto, port)
  return { cto, port }
}

export async function releaseHubsoftPort(input: {
  hubsoftCtoId: string
  hubsoftPortId: string
}) {
  await setHubsoftPortReserved(input.hubsoftPortId, false, null)
  await updateHubsoftPortReference(input.hubsoftPortId, null)

  const cto = await fetchHubsoftCtoById(input.hubsoftCtoId)
  const port = cto.ports.find((item) => item.id === input.hubsoftPortId)
  if (port) {
    await updateHubsoftPortCache(cto, port)
  }

  return { cto, port }
}

export async function syncCtosFromHubsoft(): Promise<HubsoftSyncResult> {
  const { prisma } = await import('@/lib/prisma')
  const result: HubsoftSyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    portsCreated: 0,
    missingInHubsoft: 0,
    auditsCreated: 0,
    errors: 0,
  }

  async function findMatchingOltDevice(oltInterface: HubsoftOltInterface | null) {
    if (!oltInterface) {
      return null
    }

    const conditions: string[] = []
    const params: string[] = []

    if (oltInterface.hubsoftOltDeviceId) {
      conditions.push('"hubsoftId" = ?')
      params.push(oltInterface.hubsoftOltDeviceId)
    }

    if (oltInterface.oltIpv4) {
      conditions.push('("ipv4" = ? OR "host" = ?)')
      params.push(oltInterface.oltIpv4, oltInterface.oltIpv4)
    }

    if (oltInterface.oltName) {
      conditions.push('"name" = ?')
      params.push(oltInterface.oltName)
    }

    if (conditions.length === 0) {
      return null
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; hubsoftId: string | null }>>(`
      SELECT "id", "hubsoftId"
      FROM "OltDevice"
      WHERE ${conditions.join(' OR ')}
      ORDER BY "isDefault" DESC, "updatedAt" DESC
      LIMIT 1
    `, ...params)
    const device = rows[0]

    if (device && oltInterface.hubsoftOltDeviceId && !device.hubsoftId) {
      await prisma.$executeRaw`
        UPDATE "OltDevice"
        SET "hubsoftId" = ${oltInterface.hubsoftOltDeviceId}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${device.id}
      `
    }

    return device ?? null
  }

  async function upsertLocalOltInterface(oltInterface: HubsoftOltInterface | null) {
    if (!oltInterface || oltInterface.chassi === null || oltInterface.slot === null || oltInterface.pon === null) {
      return null
    }

    const device = await findMatchingOltDevice(oltInterface)
    if (!device) {
      return null
    }

    const existingByHubsoftId = oltInterface.hubsoftInterfaceId
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "OltInterface"
          WHERE "hubsoftId" = ${oltInterface.hubsoftInterfaceId}
          LIMIT 1
        `
      : []
    const existingByPosition = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OltInterface"
      WHERE "oltDeviceId" = ${device.id}
        AND "type" = ${oltInterface.type}
        AND "chassi" = ${oltInterface.chassi}
        AND "slot" = ${oltInterface.slot}
        AND "pon" = ${oltInterface.pon}
      LIMIT 1
    `
    const existingId = existingByHubsoftId[0]?.id ?? existingByPosition[0]?.id

    if (existingId) {
      await prisma.$executeRaw`
        UPDATE "OltInterface"
        SET
          "hubsoftId" = ${oltInterface.hubsoftInterfaceId},
          "name" = ${oltInterface.name},
          "description" = ${oltInterface.description ?? oltInterface.display},
          "vlan" = ${oltInterface.vlan},
          "requireCtoLink" = ${oltInterface.requireCtoLink},
          "blockOverutilization" = ${oltInterface.blockOverutilization},
          "alarmSubscriberSignal" = ${oltInterface.alarmSubscriberSignal},
          "alarmEquipmentSignal" = ${oltInterface.alarmEquipmentSignal},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${existingId}
      `

      return existingId
    }

    const id = createLocalId('olt_interface')
    await prisma.$executeRaw`
      INSERT INTO "OltInterface" (
        "id",
        "hubsoftId",
        "oltDeviceId",
        "type",
        "name",
        "description",
        "chassi",
        "slot",
        "pon",
        "vlan",
        "requireCtoLink",
        "blockOverutilization",
        "alarmSubscriberSignal",
        "alarmEquipmentSignal",
        "isActive"
      ) VALUES (
        ${id},
        ${oltInterface.hubsoftInterfaceId},
        ${device.id},
        ${oltInterface.type},
        ${oltInterface.name},
        ${oltInterface.description ?? oltInterface.display},
        ${oltInterface.chassi},
        ${oltInterface.slot},
        ${oltInterface.pon},
        ${oltInterface.vlan},
        ${oltInterface.requireCtoLink},
        ${oltInterface.blockOverutilization},
        ${oltInterface.alarmSubscriberSignal},
        ${oltInterface.alarmEquipmentSignal},
        true
      )
    `

    return id
  }

  async function updateCtoImportedOltData(
    ctoId: string,
    oltInterface: HubsoftOltInterface | null,
    linkedOltInterfaceId: string | null,
  ) {
    await prisma.$executeRaw`
      UPDATE "CTO"
      SET
        "hubsoftOltDeviceId" = ${oltInterface?.hubsoftOltDeviceId ?? null},
        "hubsoftOltInterfaceId" = ${oltInterface?.hubsoftInterfaceId ?? null},
        "oltDeviceName" = ${oltInterface?.oltName ?? null},
        "oltIpv4" = ${oltInterface?.oltIpv4 ?? null},
        "oltInterfaceName" = ${oltInterface?.name ?? null},
        "oltInterfaceType" = ${oltInterface?.type ?? null},
        "oltInterfaceIdentifier" = ${oltInterface?.identifier ?? null},
        "oltChassi" = ${oltInterface?.chassi ?? null},
        "oltSlot" = ${oltInterface?.slot ?? null},
        "oltPon" = ${oltInterface?.pon ?? null},
        "oltVlan" = ${oltInterface?.vlan ?? null},
        "oltInterfaceId" = ${linkedOltInterfaceId}
      WHERE "id" = ${ctoId}
    `
  }

  try {
    const hubsoftCtos = await fetchHubsoftCTOs()
    const hubsoftIds = new Set(hubsoftCtos.map((cto) => cto.id))

    for (const hubsoftCto of hubsoftCtos) {
      try {
        const linkedOltInterfaceId = await upsertLocalOltInterface(hubsoftCto.oltInterface)
        const importedOlt = hubsoftCto.oltInterface
        const existingCto = await prisma.cTO.findUnique({ where: { hubsoftId: hubsoftCto.id } })
        const cto = await upsertHubsoftCtoCoreCache(hubsoftCto)
        await updateCtoImportedOltData(cto.id, importedOlt, linkedOltInterfaceId)
        await updateHubsoftCtoOccupationCache(hubsoftCto)

        if (existingCto) {
          result.updated++
        } else {
          result.created++
        }

        // Hubsoft is the external source of truth for CTO occupation. The local
        // database mirrors these values so regular screens avoid API fan-out.
        for (const port of hubsoftCto.ports) {
          const existingPorts = await prisma.$queryRaw<Array<{ id: string; ctoId: string; provisioningId: string | null }>>`
            SELECT "Port"."id", "Port"."ctoId", "Provisioning"."id" AS "provisioningId"
            FROM "Port"
            LEFT JOIN "Provisioning" ON "Provisioning"."portId" = "Port"."id"
            WHERE "Port"."hubsoftId" = ${port.id} OR "Port"."id" = ${port.id}
            LIMIT 1
          `
          const existingPort = existingPorts[0] ?? null

          if (!existingPort) {
            await prisma.$executeRaw`
              INSERT INTO "Port" (
                "id",
                "hubsoftId",
                "number",
                "status",
                "ctoId",
                "hubsoftReserved",
                "hubsoftReference",
                "hubsoftHasClientService",
                "hubsoftRawStatus",
                "hubsoftLastSync"
              ) VALUES (
                ${port.id},
                ${port.id},
                ${port.number},
                ${port.status},
                ${cto.id},
                ${port.reserved},
                ${port.reference},
                ${port.hasClientService},
                ${port.rawStatus},
                ${new Date()}
              )
            `
            result.portsCreated++
            continue
          }

          await prisma.$executeRaw`
            UPDATE "Port"
            SET
              "hubsoftId" = ${port.id},
              "number" = ${port.number},
              "ctoId" = CASE WHEN ${existingPort.provisioningId} IS NULL THEN ${cto.id} ELSE "ctoId" END,
              "status" = ${port.status},
              "hubsoftReserved" = ${port.reserved},
              "hubsoftReference" = ${port.reference},
              "hubsoftHasClientService" = ${port.hasClientService},
              "hubsoftRawStatus" = ${port.rawStatus},
              "hubsoftLastSync" = ${new Date()}
            WHERE "id" = ${existingPort.id}
          `
        }

        result.synced++
      } catch (error) {
        console.error(`Error syncing CTO ${hubsoftCto.id}:`, error)
        result.errors++
        const importedOlt = hubsoftCto.oltInterface
        const cto = await prisma.cTO.upsert({
          where: { hubsoftId: hubsoftCto.id },
          update: {
            syncStatus: SYNC_STATUS_ERROR,
            syncError: (error as Error).message,
          },
          create: {
            hubsoftId: hubsoftCto.id,
            name: hubsoftCto.name,
            address: hubsoftCto.address,
            lat: hubsoftCto.lat,
            lng: hubsoftCto.lng,
            syncStatus: SYNC_STATUS_ERROR,
            syncError: (error as Error).message,
          },
        })
        await updateCtoImportedOltData(cto.id, importedOlt, null)
      }
    }

    const localHubsoftCtos = await prisma.cTO.findMany({
      where: {
        hubsoftId: { not: null },
        OR: [
          { syncStatus: null },
          { syncStatus: { not: SYNC_STATUS_MISSING_IN_HUBSOFT } },
        ],
      },
      include: {
        ports: {
          include: { provisioning: true },
        },
      },
    })

    for (const cto of localHubsoftCtos) {
      if (!cto.hubsoftId || hubsoftIds.has(cto.hubsoftId)) {
        continue
      }

      const provisioningCount = cto.ports.filter((port) => port.provisioning).length
      const reason = provisioningCount > 0
        ? 'CTO nao retornou na Hubsoft. Revisar e mover manualmente os provisionamentos antes de remover.'
        : 'CTO nao retornou na Hubsoft. Revisar antes de remover do cadastro local.'

      await prisma.cTO.update({
        where: { id: cto.id },
        data: {
          syncStatus: SYNC_STATUS_MISSING_IN_HUBSOFT,
          syncError: reason,
        },
      })

      await prisma.$executeRaw`UPDATE "CTO" SET "hubsoftDeletedAt" = ${new Date()} WHERE "id" = ${cto.id}`
      await prisma.$executeRaw`
        INSERT INTO "CtoSyncAudit" (
          "id",
          "ctoId",
          "hubsoftId",
          "ctoName",
          "action",
          "reason",
          "provisioningCount",
          "portCount"
        ) VALUES (
          ${createAuditId()},
          ${cto.id},
          ${cto.hubsoftId},
          ${cto.name},
          ${SYNC_STATUS_MISSING_IN_HUBSOFT},
          ${reason},
          ${provisioningCount},
          ${cto.ports.length}
        )
      `

      result.missingInHubsoft++
      result.auditsCreated++
    }
  } catch (error) {
    console.error('Failed to sync CTOs from Hubsoft:', error)
    throw error
  }

  return result
}
