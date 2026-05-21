import { prisma } from './prisma'
import {
  getDefaultOltDevice,
  getOltDeviceConnectionByHubsoftMetadata,
  getOltDeviceConnectionById,
  type OltDeviceConnection,
} from './olt-devices'
import { getDefaultOltInterface } from './olt-interfaces'
import { queryOltOnuBySerial, queryOltOnuState } from './olt-management'
import { executeOltCommandsOverSsh } from './olt-ssh'
import { getDefaultOperatorProfile } from './operator-profiles'
import { addProvisioningLog } from './provisioning-logs'
import { getCompatibleCpeModelOltProfile, normalizeOltIdentity } from './cpe-model-olt-profiles'

type ProvisioningWithRelations = NonNullable<Awaited<ReturnType<typeof getProvisioningContext>>>

type OltDriverId = 'http-json' | 'zte-c650'

type CtoOltMetadata = {
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
  oltInterface: {
    id: string
    oltDeviceId: string
    name: string
    description: string | null
    chassi: number
    slot: number
    pon: number
    vlan: number | null
    routingInterface: string | null
  } | null
}

type OltProvisioningProfile = {
  cpeOltProfileId?: string
  driver?: OltDriverId
  name?: string
  vlan?: number
  serviceVlan?: number
  lineProfile?: string
  serviceProfile?: string
  onuType?: string
  chassi?: string | number
  slot?: string | number
  pon?: string | number
  onuId?: string | number
  gemPort?: string | number
  tcont?: string | number
  serviceName?: string
  authorizationCommands?: string | null
  provisioningCommands?: string | null
  deprovisioningCommands?: string | null
  deauthorizationCommands?: string | null
  tr069Commands?: string | null
  genieAcsParameterMapJson?: string | null
  requiredVariablesJson?: string | null
  oltManufacturer?: string
  oltModel?: string
  oltDriver?: string
  interfaceId?: string
  interfaceName?: string
  interfaceDescription?: string | null
  routingInterface?: string | null
}

type OltProvisioningContext = {
  driverId: OltDriverId
  profile: OltProvisioningProfile
  provisioning: ProvisioningWithRelations
  operatorVlan: number | null
  oltDevice: OltDeviceConnection | null
}

export type OltRegistrationResult = {
  ok: boolean
  status: 'active' | 'inactive' | 'olt_pending' | 'olt_failed'
  message: string
  driver?: OltDriverId
  commands?: string[]
  onuPosition?: {
    oltDeviceId: string
    chassi: number
    slot: number
    pon: number
    onuId: number
  }
}

export type OltSerialPrecheckResult = {
  ok: boolean
  checked: boolean
  exists: boolean
  message: string
  command?: string
  oltDevice?: string | null
  matchedLines?: string[]
  matchedPosition?: {
    chassi: number
    slot: number
    pon: number
    onuId: number
  } | null
}

type OltDriver = {
  id: OltDriverId
  label: string
  register(context: OltProvisioningContext): Promise<OltRegistrationResult>
}

const OLT_EXECUTOR_URL = process.env.OLT_EXECUTOR_URL || process.env.OLT_API_URL
const OLT_EXECUTOR_TOKEN = process.env.OLT_EXECUTOR_TOKEN || process.env.OLT_API_TOKEN
const DEFAULT_OLT_DRIVER = (process.env.OLT_DRIVER || 'zte-c650') as OltDriverId

function maskIdentifier(value: string) {
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}****${value.slice(-4)}`
}

function maskSensitiveCommand(value: string) {
  return value.replace(/(\bpassword\s+)(\S+)/gi, '$1[senha ocultada]')
}

function maskSensitiveCommands(commands: string[]) {
  return commands.map(maskSensitiveCommand)
}

function sanitizeProvisioningLogValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase()
  if (typeof value === 'string') {
    value = maskSensitiveCommand(value)
  }
  if (typeof value === 'string' && (normalizedKey.includes('serial') || normalizedKey.includes('phy_addr'))) {
    return maskIdentifier(value)
  }
  if (typeof value === 'string' && (normalizedKey.includes('password') || normalizedKey.includes('token') || normalizedKey.includes('secret'))) {
    return '[oculto]'
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProvisioningLogValue(key, item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeProvisioningLogValue(entryKey, entryValue),
      ]),
    )
  }

  return value
}

function logOltProvisioning(action: string, details: Record<string, unknown>) {
  if (process.env.OLT_PROVISIONING_DEBUG !== 'true') {
    return
  }

  console.log(`[OLT PROVISIONING] ${action}`, sanitizeProvisioningLogValue('details', details))
}

async function logProvisioningStep(
  provisioningId: string,
  input: {
    level?: 'info' | 'success' | 'warn' | 'error'
    stage: string
    message: string
    details?: Record<string, unknown>
  },
) {
  await addProvisioningLog({
    provisioningId,
    ...input,
    details: input.details ? sanitizeProvisioningLogValue('details', input.details) as Record<string, unknown> : undefined,
  })
}

async function getCtoOltMetadata(ctoId: string): Promise<CtoOltMetadata> {
  const rows = await prisma.$queryRaw<Array<{
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
    linkedInterfaceId: string | null
    linkedOltDeviceId: string | null
    linkedInterfaceName: string | null
    linkedInterfaceDescription: string | null
    linkedChassi: number | null
    linkedSlot: number | null
    linkedPon: number | null
    linkedVlan: number | null
    linkedRoutingInterface: string | null
  }>>`
    SELECT
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
      "OltInterface"."id" AS "linkedInterfaceId",
      "OltInterface"."oltDeviceId" AS "linkedOltDeviceId",
      "OltInterface"."name" AS "linkedInterfaceName",
      "OltInterface"."description" AS "linkedInterfaceDescription",
      "OltInterface"."chassi" AS "linkedChassi",
      "OltInterface"."slot" AS "linkedSlot",
      "OltInterface"."pon" AS "linkedPon",
      "OltInterface"."vlan" AS "linkedVlan",
      "OltInterface"."routingInterface" AS "linkedRoutingInterface"
    FROM "CTO"
    LEFT JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
    WHERE "CTO"."id" = ${ctoId}
    LIMIT 1
  `
  const row = rows[0]

  return {
    hubsoftOltDeviceId: row?.hubsoftOltDeviceId ?? null,
    hubsoftOltInterfaceId: row?.hubsoftOltInterfaceId ?? null,
    oltDeviceName: row?.oltDeviceName ?? null,
    oltIpv4: row?.oltIpv4 ?? null,
    oltInterfaceName: row?.oltInterfaceName ?? null,
    oltInterfaceType: row?.oltInterfaceType ?? null,
    oltInterfaceIdentifier: row?.oltInterfaceIdentifier ?? null,
    oltChassi: row?.oltChassi ?? null,
    oltSlot: row?.oltSlot ?? null,
    oltPon: row?.oltPon ?? null,
    oltVlan: row?.oltVlan ?? null,
    oltInterface: row?.linkedInterfaceId && row.linkedOltDeviceId && row.linkedInterfaceName && row.linkedChassi !== null && row.linkedSlot !== null && row.linkedPon !== null
      ? {
          id: row.linkedInterfaceId,
          oltDeviceId: row.linkedOltDeviceId,
          name: row.linkedInterfaceName,
          description: row.linkedInterfaceDescription,
          chassi: row.linkedChassi,
          slot: row.linkedSlot,
          pon: row.linkedPon,
          vlan: row.linkedVlan,
          routingInterface: row.linkedRoutingInterface,
        }
      : null,
  }
}

async function getProvisioningContext(provisioningId: string) {
  const provisioning = await prisma.provisioning.findUnique({
    where: { id: provisioningId },
    include: {
      contract: {
        include: {
          landlord: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
      },
      port: {
        include: { cto: true },
      },
      cpeModel: {
        select: { id: true, name: true, description: true },
      },
    },
  })

  if (!provisioning) {
    return null
  }

  const erpLinkRows = await prisma.$queryRaw<Array<{
    id: string
    provider: string
    customerExternalId: string | null
    customerDisplayCode: string | null
    customerUrl: string | null
    serviceExternalId: string | null
    contractExternalId: string | null
    serviceDisplayCode: string | null
    serviceUrl: string | null
    planName: string | null
    login: string | null
    pppoePassword: string | null
    document: string | null
    rawJson: string | null
    linkedAt: Date | string
  }>>`
    SELECT "id", "provider", "customerExternalId", "customerDisplayCode", "customerUrl",
           "serviceExternalId", "contractExternalId", "serviceDisplayCode", "serviceUrl",
           "planName", "login", "pppoePassword", "document", "rawJson", "linkedAt"
    FROM "ErpLink"
    WHERE "contractId" = ${provisioning.contractId}
    LIMIT 1
  `
  const contractCredentialRows = await prisma.$queryRaw<Array<{
    pppoeLogin: string | null
    pppoePassword: string | null
  }>>`
    SELECT "pppoeLogin", "pppoePassword"
    FROM "Contract"
    WHERE "id" = ${provisioning.contractId}
    LIMIT 1
  `
  const ctoOltMetadata = await getCtoOltMetadata(provisioning.port.cto.id)

  return {
    ...provisioning,
    contract: {
      ...provisioning.contract,
      pppoeLogin: contractCredentialRows[0]?.pppoeLogin ?? null,
      pppoePassword: contractCredentialRows[0]?.pppoePassword ?? null,
      erpLink: erpLinkRows[0]
        ? {
            ...erpLinkRows[0],
            linkedAt: new Date(erpLinkRows[0].linkedAt).toISOString(),
          }
        : null,
    },
    port: {
      ...provisioning.port,
      cto: {
        ...provisioning.port.cto,
        ...ctoOltMetadata,
      },
    },
  }
}

class CpeOltCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CpeOltCompatibilityError'
  }
}

function getNumberEnv(key: string, fallback: number) {
  const value = Number(process.env[key])
  return Number.isFinite(value) ? value : fallback
}

async function getProvisioningOltDevice(
  provisioning: ProvisioningWithRelations,
  driverId: OltDriverId,
) {
  const cto = provisioning.port.cto

  if (cto.oltInterface?.oltDeviceId) {
    return getOltDeviceConnectionById(cto.oltInterface.oltDeviceId)
  }

  const hasImportedOlt = Boolean(cto.hubsoftOltDeviceId || cto.oltIpv4 || cto.oltDeviceName)
  if (hasImportedOlt) {
    return getOltDeviceConnectionByHubsoftMetadata({
      hubsoftId: cto.hubsoftOltDeviceId,
      ipv4: cto.oltIpv4,
      name: cto.oltDeviceName,
    })
  }

  return getDefaultOltDevice(driverId)
}

async function getPortOltDevice(portId: string, driverId: OltDriverId) {
  const port = await prisma.port.findUnique({
    where: { id: portId },
    include: { cto: true },
  })

  if (!port) {
    return { port: null, oltDevice: null }
  }

  const ctoOltMetadata = await getCtoOltMetadata(port.cto.id)
  const cto = {
    ...port.cto,
    ...ctoOltMetadata,
  }

  if (cto.oltInterface?.oltDeviceId) {
    return { port: { ...port, cto }, oltDevice: await getOltDeviceConnectionById(cto.oltInterface.oltDeviceId) }
  }

  const hasImportedOlt = Boolean(cto.hubsoftOltDeviceId || cto.oltIpv4 || cto.oltDeviceName)
  if (hasImportedOlt) {
    return {
      port: { ...port, cto },
      oltDevice: await getOltDeviceConnectionByHubsoftMetadata({
        hubsoftId: cto.hubsoftOltDeviceId,
        ipv4: cto.oltIpv4,
        name: cto.oltDeviceName,
      }),
    }
  }

  return { port: { ...port, cto }, oltDevice: await getDefaultOltDevice(driverId) }
}

export async function checkSerialAvailableOnOlt(portId: string, serial: string, driverId = DEFAULT_OLT_DRIVER): Promise<OltSerialPrecheckResult> {
  const cleanSerial = serial.trim()
  if (!cleanSerial) {
    return {
      ok: false,
      checked: false,
      exists: false,
      message: 'Serial GPON é obrigatório para verificar duplicidade na OLT.',
    }
  }

  const { port, oltDevice } = await getPortOltDevice(portId, driverId)
  if (!port) {
    return {
      ok: false,
      checked: false,
      exists: false,
      message: 'Porta da CTO não encontrada para verificar serial na OLT.',
    }
  }

  if (!oltDevice || !oltDevice.isActive) {
    return {
      ok: true,
      checked: false,
      exists: false,
      oltDevice: oltDevice?.name ?? null,
      message: 'Verificação de serial ignorada porque a OLT da CTO não está cadastrada/ativa localmente.',
    }
  }

  try {
    const lookup = await queryOltOnuBySerial(oltDevice, cleanSerial)
    if (!lookup.isRecognizedOutput) {
      return {
        ok: false,
        checked: true,
        exists: false,
        command: lookup.command,
        oltDevice: oltDevice.name,
        message: `A OLT ${oltDevice.name} não retornou uma resposta reconhecida para a consulta do serial ${cleanSerial}.`,
      }
    }

    if (lookup.exists) {
      return {
        ok: false,
        checked: true,
        exists: true,
        command: lookup.command,
        oltDevice: oltDevice.name,
        matchedLines: lookup.matchedLines,
        matchedPosition: lookup.matchedPosition,
        message: `A ONU/CPE com serial ${cleanSerial} já existe na OLT ${oltDevice.name}. Remova o cadastro existente antes de provisionar novamente.`,
      }
    }

    return {
      ok: true,
      checked: true,
      exists: false,
      command: lookup.command,
      oltDevice: oltDevice.name,
      message: `Serial ${cleanSerial} não encontrado na OLT ${oltDevice.name}.`,
    }
  } catch (error) {
    return {
      ok: false,
      checked: true,
      exists: false,
      oltDevice: oltDevice.name,
      message: `Falha ao verificar serial ${cleanSerial} na OLT ${oltDevice.name}: ${(error as Error).message}`,
    }
  }
}

async function buildProfile(
  provisioning: ProvisioningWithRelations,
  oltDevice?: OltDeviceConnection | null,
  operatorProfile?: Awaited<ReturnType<typeof getDefaultOperatorProfile>> | null,
): Promise<OltProvisioningProfile> {
  const linkedInterface = provisioning.port.cto.oltInterface
  const defaultInterface = linkedInterface && (!oltDevice || linkedInterface.oltDeviceId === oltDevice.id)
    ? linkedInterface
    : oltDevice
      ? await getDefaultOltInterface(oltDevice.id)
      : null
  const importedInterface = !defaultInterface
    && provisioning.port.cto.oltChassi !== null
    && provisioning.port.cto.oltSlot !== null
    && provisioning.port.cto.oltPon !== null
    ? {
        interfaceName: provisioning.port.cto.oltInterfaceName ?? undefined,
        interfaceDescription: provisioning.port.cto.oltInterfaceIdentifier ?? undefined,
        chassi: provisioning.port.cto.oltChassi,
        slot: provisioning.port.cto.oltSlot,
        pon: provisioning.port.cto.oltPon,
        serviceVlan: provisioning.port.cto.oltVlan ?? getNumberEnv('OLT_DEFAULT_SERVICE_VLAN', 600),
      }
    : null
  const interfaceProfile = defaultInterface
    ? {
        interfaceId: defaultInterface.id,
        interfaceName: defaultInterface.name,
        interfaceDescription: defaultInterface.description,
        chassi: defaultInterface.chassi,
        slot: defaultInterface.slot,
        pon: defaultInterface.pon,
        serviceVlan: defaultInterface.vlan ?? getNumberEnv('OLT_DEFAULT_SERVICE_VLAN', 600),
        routingInterface: defaultInterface.routingInterface,
      }
    : importedInterface ?? { serviceVlan: getNumberEnv('OLT_DEFAULT_SERVICE_VLAN', 600) }
  const cpeOltProfile = oltDevice
    ? await getCompatibleCpeModelOltProfile(provisioning.cpeModelId, {
        manufacturer: oltDevice.manufacturer,
        model: oltDevice.model,
        driver: oltDevice.driver,
      })
    : null
  const compatibilityIdentity = oltDevice ? normalizeOltIdentity(oltDevice) : null

  if (oltDevice && !cpeOltProfile) {
    throw new CpeOltCompatibilityError(
      `Modelo ${provisioning.cpeModel.name} nao possui perfil de ONU compativel com a OLT ${oltDevice.manufacturer} ${oltDevice.model} usando driver ${oltDevice.driver}.`,
    )
  }

  const cpeProfileData = cpeOltProfile
    ? {
        cpeOltProfileId: cpeOltProfile.id,
        driver: cpeOltProfile.oltDriver as OltDriverId,
        name: `${provisioning.cpeModel.name} / ${cpeOltProfile.oltManufacturer} ${cpeOltProfile.oltModel}`,
        onuType: cpeOltProfile.onuType ?? undefined,
        authorizationCommands: cpeOltProfile.authorizationCommands,
        provisioningCommands: cpeOltProfile.provisioningCommands,
        deprovisioningCommands: cpeOltProfile.deprovisioningCommands,
        deauthorizationCommands: cpeOltProfile.deauthorizationCommands,
        tr069Commands: cpeOltProfile.tr069Commands,
        genieAcsParameterMapJson: cpeOltProfile.genieAcsParameterMapJson,
        requiredVariablesJson: cpeOltProfile.requiredVariablesJson,
      }
    : {}
  const operatorProfileData = operatorProfile
    ? {
        driver: operatorProfile.driver as OltDriverId,
        name: operatorProfile.name,
        vlan: operatorProfile.vlan ?? undefined,
        serviceVlan: operatorProfile.serviceVlan ?? undefined,
        lineProfile: operatorProfile.lineProfile ?? undefined,
        serviceProfile: operatorProfile.serviceProfile ?? undefined,
        gemPort: operatorProfile.gemPort ?? undefined,
        tcont: operatorProfile.tcont ?? undefined,
        serviceName: operatorProfile.serviceName ?? undefined,
      }
    : {}

  return {
    driver: DEFAULT_OLT_DRIVER,
    gemPort: process.env.OLT_DEFAULT_GEM_PORT || 1,
    tcont: process.env.OLT_DEFAULT_TCONT || 1,
    serviceName: process.env.OLT_DEFAULT_SERVICE_NAME || 'internet',
    ...interfaceProfile,
    ...operatorProfileData,
    ...cpeProfileData,
    ...(compatibilityIdentity ? {
      oltManufacturer: compatibilityIdentity.manufacturer,
      oltModel: compatibilityIdentity.model,
      oltDriver: compatibilityIdentity.driver,
    } : {}),
  }
}

function getValueByPath(source: unknown, path: string): string {
  const value = path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined
    }

    return (current as Record<string, unknown>)[key]
  }, source)

  return value === undefined || value === null ? '' : String(value)
}

function cleanTemplateValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function firstCredentialValue(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return ''
  for (const key of keys) {
    if (record[key] && typeof record[key] === 'object') continue
    const value = cleanTemplateValue(record[key])
    if (value) return value
  }
  return ''
}

function firstDeepCredentialValue(source: unknown, keys: string[], maxDepth = 5) {
  const seen = new Set<unknown>()
  const search = (value: unknown, depth: number): string => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > maxDepth) return ''
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = search(item, depth + 1)
        if (nested) return nested
      }
      return ''
    }

    const record = value as Record<string, unknown>
    const direct = firstCredentialValue(record, keys)
    if (direct) return direct

    for (const item of Object.values(record)) {
      const nested = search(item, depth + 1)
      if (nested) return nested
    }

    return ''
  }

  return search(source, 0)
}

function extractPppoePasswordFromRawJson(rawJson?: string | null) {
  if (!rawJson) return ''
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const service = parsed.service && typeof parsed.service === 'object' ? parsed.service as Record<string, unknown> : null
    const customer = parsed.customer && typeof parsed.customer === 'object' ? parsed.customer as Record<string, unknown> : null
    const keys = [
      'senha_pppoe',
      'senhaPppoe',
      'pppoe_password',
      'pppoePassword',
      'password_pppoe',
      'passwordPppoe',
      'senha_radius',
      'senhaRadius',
      'password_radius',
      'passwordRadius',
      'senha_conexao',
      'senhaConexao',
      'senha_autenticacao',
      'senhaAutenticacao',
      'senha',
      'password',
    ]
    return firstCredentialValue(service, keys)
      || firstDeepCredentialValue(service, keys)
      || firstCredentialValue(customer, keys)
      || firstDeepCredentialValue(customer, keys)
  } catch {
    return ''
  }
}

function buildTemplateContext(context: OltProvisioningContext) {
  const operatorVlan = context.operatorVlan
  const erpLink = context.provisioning.contract.erpLink
  const contractCredentials = context.provisioning.contract as typeof context.provisioning.contract & {
    pppoeLogin?: string | null
    pppoePassword?: string | null
  }
  const pppoeLogin = cleanTemplateValue(erpLink?.login) || cleanTemplateValue(contractCredentials.pppoeLogin)
  const pppoePassword = cleanTemplateValue(erpLink?.pppoePassword)
    || cleanTemplateValue(contractCredentials.pppoePassword)
    || extractPppoePasswordFromRawJson(erpLink?.rawJson)

  const aliases: Record<string, unknown> = {
    vlan: operatorVlan,
    service_vlan: context.profile.serviceVlan,
    login: pppoeLogin,
    senha: pppoePassword,
    pppoe_login: pppoeLogin,
    pppoe_password: pppoePassword,
    chassi: context.profile.chassi ?? 1,
    slot: context.profile.slot,
    pon: context.profile.pon,
    indice_onu: context.profile.onuId ?? context.provisioning.port.number,
    phy_addr: context.provisioning.serial,
    onu_type: context.profile.onuType ?? context.provisioning.cpeModel.name,
    gemport: context.profile.gemPort,
    tcont: context.profile.tcont,
    service_name: context.profile.serviceName,
    interface_id: context.profile.interfaceId,
    interface_name: context.profile.interfaceName,
    interface_description: context.profile.interfaceDescription,
    routing_interface: context.profile.routingInterface,
  }
  const templateContext = {
    ...aliases,
    profile: context.profile,
    provisioning: context.provisioning,
    contract: context.provisioning.contract,
    operator: context.provisioning.contract.landlord.user,
    operatorVlan,
    cto: context.provisioning.port.cto,
    port: context.provisioning.port,
    cpeModel: context.provisioning.cpeModel,
    serial: context.provisioning.serial,
  }

  return { templateContext, pppoeLogin, pppoePassword }
}

function renderTemplate(template: string, context: OltProvisioningContext) {
  const { templateContext, pppoeLogin, pppoePassword } = buildTemplateContext(context)

  if (/\bwan-ip\b.*\bpppoe\b/i.test(template) && (!pppoeLogin || !pppoePassword)) {
    return ''
  }

  const replaceToken = (_match: string, path: string) => getValueByPath(templateContext, path)

  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, replaceToken)
    .replace(/\[\[\s*([\w.]+)\s*\]\]/g, replaceToken)
}

function parseRequiredVariables(value?: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.map((item) => cleanTemplateValue(item)).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function validateRequiredVariables(context: OltProvisioningContext) {
  const requiredVariables = parseRequiredVariables(context.profile.requiredVariablesJson)
  if (!requiredVariables.length) return []

  const { templateContext } = buildTemplateContext(context)
  return requiredVariables.filter((variable) => !cleanTemplateValue(getValueByPath(templateContext, variable)))
}

function splitCommandBlock(commands?: string | null) {
  if (!commands) {
    return []
  }

  return commands
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function normalizeCommandBlock(commands?: string | null) {
  return splitCommandBlock(commands).map((command) => command.toLowerCase()).join('\n')
}

function splitOperationalCommands(commands?: string | null) {
  if (!commands) {
    return []
  }

  return commands
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function getOltCliErrors(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^%Error\b/i.test(line))
}

function getAuthorizationCommandTemplates(profile: OltProvisioningProfile) {
  return splitCommandBlock(profile.authorizationCommands)
}

function getProvisioningCommandTemplates(profile: OltProvisioningProfile) {
  return splitCommandBlock(profile.provisioningCommands)
}

async function runZteCommandStage(input: {
  context: OltProvisioningContext
  commands: string[]
  logStage: string
  startMessage: string
  cliErrorMessage: string
  sshErrorMessage: string
}) {
  const { context, commands, logStage, startMessage, cliErrorMessage, sshErrorMessage } = input
  if (!context.oltDevice) {
    throw new Error('OLT não definida para execução de comandos.')
  }

  await logProvisioningStep(context.provisioning.id, {
    stage: `${logStage}.started`,
    message: startMessage,
    details: {
      oltDevice: context.oltDevice.name,
      commandCount: commands.length,
      commands,
    },
  })

  try {
    const result = await executeOltCommandsOverSsh(context.oltDevice, commands, {
      allowPartialOnDisconnect: true,
      stopOnCliError: true,
      exitCommands: splitOperationalCommands(context.oltDevice.exitCommands),
    })
    const cliErrors = getOltCliErrors(`${result.output}\n${result.stderr}`)
    if (cliErrors.length > 0) {
      await logProvisioningStep(context.provisioning.id, {
        level: 'error',
        stage: `${logStage}.cli_error`,
        message: cliErrorMessage,
        details: {
          oltDevice: context.oltDevice.name,
          errors: cliErrors,
        },
      })
      return {
        ok: false,
        message: `${cliErrorMessage}: ${cliErrors.slice(0, 3).join(' | ')}`,
      }
    }

    await logProvisioningStep(context.provisioning.id, {
      level: 'success',
      stage: `${logStage}.success`,
      message: `${startMessage} concluida.`,
      details: {
        oltDevice: context.oltDevice.name,
        commandCount: commands.length,
      },
    })
    return { ok: true }
  } catch (error) {
    await logProvisioningStep(context.provisioning.id, {
      level: 'error',
      stage: `${logStage}.failed`,
      message: sshErrorMessage,
      details: {
        oltDevice: context.oltDevice.name,
        error: (error as Error).message,
      },
    })
    return {
      ok: false,
      message: `${sshErrorMessage}: ${(error as Error).message}`,
    }
  }
}

function getDeprovisionCommandTemplates(profile: OltProvisioningProfile) {
  const deprovisioningCommands = splitCommandBlock(profile.deprovisioningCommands)
  const deauthorizationCommands = splitCommandBlock(profile.deauthorizationCommands)
  const hasDuplicatedRemovalBlock = deprovisioningCommands.length > 0
    && deauthorizationCommands.length > 0
    && normalizeCommandBlock(profile.deprovisioningCommands) === normalizeCommandBlock(profile.deauthorizationCommands)

  if (hasDuplicatedRemovalBlock) {
    return deprovisioningCommands
  }

  return [
    ...deprovisioningCommands,
    ...deauthorizationCommands,
  ]
}

async function confirmDeprovisionCompletedBySerialAbsence(input: {
  provisioningId: string
  provisioning: ProvisioningWithRelations
  oltDevice: OltDeviceConnection
  driverId: OltDriverId
  commands: string[]
  reason: string
}) {
  const { provisioningId, provisioning, oltDevice, driverId, commands, reason } = input

  try {
    const lookup = await queryOltOnuBySerial(oltDevice, provisioning.serial)
    await logProvisioningStep(provisioningId, {
      level: lookup.isRecognizedOutput && !lookup.exists ? 'warn' : 'error',
      stage: 'olt.deprovision.post_error_serial_lookup_finished',
      message: lookup.isRecognizedOutput && !lookup.exists
        ? 'ONU/CPE nao encontrada apos erro no desprovisionamento; remocao considerada concluida.'
        : 'ONU/CPE ainda aparece na OLT apos erro no desprovisionamento.',
      details: {
        reason,
        command: lookup.command,
        exists: lookup.exists,
        recognizedOutput: lookup.isRecognizedOutput,
        matchedLines: lookup.matchedLines,
        matchedPosition: lookup.matchedPosition,
      },
    })

    if (lookup.isRecognizedOutput && !lookup.exists) {
      return {
        ok: true,
        status: 'inactive' as const,
        driver: driverId,
        commands,
        message: `ONU/CPE removida da OLT ${oltDevice.name}. A OLT reportou erro, mas o serial ${provisioning.serial} nao foi encontrado na verificacao final.`,
      }
    }
  } catch (lookupError) {
    await logProvisioningStep(provisioningId, {
      level: 'error',
      stage: 'olt.deprovision.post_error_serial_lookup_failed',
      message: 'Falha ao confirmar se a ONU/CPE saiu da OLT apos erro no desprovisionamento.',
      details: {
        reason,
        error: lookupError instanceof Error ? lookupError.message : String(lookupError),
      },
    })
  }

  return null
}

async function sendToExecutor(
  context: OltProvisioningContext,
  payload: Record<string, unknown>,
  commands?: string[],
): Promise<OltRegistrationResult> {
  if (!OLT_EXECUTOR_URL) {
    return {
      ok: false,
      status: 'olt_pending',
      driver: context.driverId,
      commands,
      message: 'Executor da OLT não configurado. Registro da ONU/CPE ficou pendente.',
    }
  }

  const response = await fetch(OLT_EXECUTOR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(OLT_EXECUTOR_TOKEN ? { Authorization: `Bearer ${OLT_EXECUTOR_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      driver: context.driverId,
      payload,
      commands,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return {
      ok: false,
      status: 'olt_failed',
      driver: context.driverId,
      commands,
      message: `Falha ao registrar ONU/CPE na OLT: ${response.status}${body ? ` ${body}` : ''}`,
    }
  }

  return {
    ok: true,
    status: 'active',
    driver: context.driverId,
    commands,
    message: 'ONU/CPE registrada na OLT com sucesso.',
  }
}

const httpJsonDriver: OltDriver = {
  id: 'http-json',
  label: 'HTTP JSON genérico',
  async register(context) {
    return sendToExecutor(context, {
      provisioningId: context.provisioning.id,
      serial: context.provisioning.serial,
      profile: context.profile,
      operatorVlan: context.operatorVlan,
      cpeModel: context.provisioning.cpeModel,
      contract: context.provisioning.contract,
      cto: context.provisioning.port.cto,
      port: context.provisioning.port,
    })
  },
}

const zteC650Driver: OltDriver = {
  id: 'zte-c650',
  label: 'ZTE C650',
  async register(context) {
    logOltProvisioning('iniciando registro ZTE C650', {
      provisioningId: context.provisioning.id,
      contractNumber: context.provisioning.contract.contractNumber,
      serial: context.provisioning.serial,
      driver: context.driverId,
      oltDevice: context.oltDevice?.name ?? null,
      interface: {
        id: context.profile.interfaceId,
        name: context.profile.interfaceName,
        chassi: context.profile.chassi,
        slot: context.profile.slot,
        pon: context.profile.pon,
      },
      operatorVlan: context.operatorVlan,
      serviceVlan: context.profile.serviceVlan,
    })
    await logProvisioningStep(context.provisioning.id, {
      stage: 'olt.zte.started',
      message: 'Driver ZTE C650 iniciou o registro da ONU/CPE.',
      details: {
        oltDevice: context.oltDevice?.name ?? null,
        interface: {
          id: context.profile.interfaceId,
          name: context.profile.interfaceName,
          chassi: context.profile.chassi,
          slot: context.profile.slot,
          pon: context.profile.pon,
        },
        operatorVlan: context.operatorVlan,
        serviceVlan: context.profile.serviceVlan,
      },
    })

    if (!context.operatorVlan) {
      logOltProvisioning('registro bloqueado: operador sem VLAN', {
        provisioningId: context.provisioning.id,
      })
      await logProvisioningStep(context.provisioning.id, {
        level: 'error',
        stage: 'olt.validation.operator_vlan_missing',
        message: 'Operador sem VLAN no perfil operacional.',
      })
      return {
        ok: false,
        status: 'olt_failed',
        driver: context.driverId,
        message: 'Usuário operador sem VLAN cadastrada. Configure a VLAN antes de registrar a ONU/CPE na OLT.',
      }
    }

    if (!context.oltDevice) {
      logOltProvisioning('registro pendente: nenhuma OLT ativa encontrada', {
        provisioningId: context.provisioning.id,
        driver: context.driverId,
        hubsoftOltDeviceId: context.provisioning.port.cto.hubsoftOltDeviceId,
        oltDeviceName: context.provisioning.port.cto.oltDeviceName,
        oltIpv4: context.provisioning.port.cto.oltIpv4,
      })
      const importedOltName = context.provisioning.port.cto.oltDeviceName || context.provisioning.port.cto.oltIpv4
      await logProvisioningStep(context.provisioning.id, {
        level: 'warn',
        stage: 'olt.validation.device_missing',
        message: importedOltName
          ? `CTO pertence a OLT ${importedOltName}, mas essa OLT nao esta cadastrada/ativa localmente.`
          : 'Nenhuma OLT ativa encontrada para este provisionamento.',
        details: {
          driver: context.driverId,
          hubsoftOltDeviceId: context.provisioning.port.cto.hubsoftOltDeviceId,
          oltDeviceName: context.provisioning.port.cto.oltDeviceName,
          oltIpv4: context.provisioning.port.cto.oltIpv4,
        },
      })
      return {
        ok: false,
        status: 'olt_pending',
        driver: context.driverId,
        message: importedOltName
          ? `A CTO pertence a OLT ${importedOltName}, mas essa OLT nao esta cadastrada/ativa localmente. Cadastre ou vincule a OLT antes de registrar a ONU/CPE.`
          : 'Nenhuma OLT ativa cadastrada para este driver. Cadastre a OLT antes de registrar a ONU/CPE.',
      }
    }

    if (context.profile.chassi === undefined || context.profile.slot === undefined || context.profile.pon === undefined) {
      logOltProvisioning('registro pendente: interface GPON nao configurada', {
        provisioningId: context.provisioning.id,
        oltDevice: context.oltDevice.name,
      })
      await logProvisioningStep(context.provisioning.id, {
        level: 'warn',
        stage: 'olt.validation.interface_missing',
        message: 'Interface GPON da OLT nao configurada no contexto da CTO.',
        details: { oltDevice: context.oltDevice.name },
      })
      return {
        ok: false,
        status: 'olt_pending',
        driver: context.driverId,
        message: 'Interface GPON da OLT não configurada. Cadastre a interface antes de registrar a ONU/CPE.',
      }
    }

    let selectedOnuId: number | null = null
    let contextWithOnuId: OltProvisioningContext | null = null
    let shouldRunAuthorization = true
    let resumedFromExistingAuthorization = false

    try {
      await logProvisioningStep(context.provisioning.id, {
        stage: 'olt.resume.serial_lookup_started',
        message: 'Verificando se a ONU/CPE ja esta autorizada na OLT.',
        details: {
          serial: context.provisioning.serial,
          oltDevice: context.oltDevice.name,
        },
      })
      const lookup = await queryOltOnuBySerial(context.oltDevice, context.provisioning.serial)
      await logProvisioningStep(context.provisioning.id, {
        level: lookup.exists ? 'warn' : 'info',
        stage: 'olt.resume.serial_lookup_finished',
        message: lookup.exists
          ? 'ONU/CPE ja encontrada na OLT; a autorizacao sera reaproveitada.'
          : 'ONU/CPE ainda nao encontrada na OLT; autorizacao sera iniciada.',
        details: {
          command: lookup.command,
          exists: lookup.exists,
          recognizedOutput: lookup.isRecognizedOutput,
          matchedLines: lookup.matchedLines,
          matchedPosition: lookup.matchedPosition,
        },
      })

      if (!lookup.isRecognizedOutput) {
        return {
          ok: false,
          status: 'olt_failed',
          driver: context.driverId,
          message: `A OLT ${context.oltDevice.name} não retornou uma resposta reconhecida para localizar o serial ${context.provisioning.serial}.`,
        }
      }

      if (lookup.exists) {
        if (!lookup.matchedPosition) {
          return {
            ok: false,
            status: 'olt_failed',
            driver: context.driverId,
            message: `A ONU/CPE ${context.provisioning.serial} ja existe na OLT ${context.oltDevice.name}, mas a posição chassi/slot/PON/ONU não pôde ser identificada para continuar o provisionamento.`,
          }
        }

        selectedOnuId = lookup.matchedPosition.onuId
        contextWithOnuId = {
          ...context,
          profile: {
            ...context.profile,
            chassi: lookup.matchedPosition.chassi,
            slot: lookup.matchedPosition.slot,
            pon: lookup.matchedPosition.pon,
            onuId: selectedOnuId,
          },
        }
        shouldRunAuthorization = false
        resumedFromExistingAuthorization = true
      }
    } catch (error) {
      await logProvisioningStep(context.provisioning.id, {
        level: 'warn',
        stage: 'olt.resume.serial_lookup_failed',
        message: 'Nao foi possivel verificar autorizacao previa; seguindo com fluxo completo.',
        details: {
          oltDevice: context.oltDevice.name,
          serial: context.provisioning.serial,
          error: (error as Error).message,
        },
      })
    }

    if (!contextWithOnuId) {
      const configuredOnuId = Number(context.profile.onuId)
      const hasConfiguredOnuId = Number.isInteger(configuredOnuId) && configuredOnuId > 0

      try {
        await logProvisioningStep(context.provisioning.id, {
          stage: 'olt.pon.position_lookup_started',
          message: 'Consultando posicoes ocupadas na PON da CTO antes de autorizar a ONU/CPE.',
          details: {
            oltDevice: context.oltDevice.name,
            chassi: context.profile.chassi,
            slot: context.profile.slot,
            pon: context.profile.pon,
            configuredOnuId: hasConfiguredOnuId ? configuredOnuId : null,
          },
        })
        const onuState = await queryOltOnuState(context.oltDevice, {
          chassi: context.profile.chassi,
          slot: context.profile.slot,
          pon: context.profile.pon,
        })

        if (!onuState.positions.isRecognizedOutput) {
          await logProvisioningStep(context.provisioning.id, {
            level: 'error',
            stage: 'olt.pon.position_lookup_unrecognized',
            message: 'A OLT nao retornou uma lista reconhecivel de posicoes ONU; registro bloqueado para evitar sobrescrita.',
            details: {
              command: onuState.command,
              output: onuState.output.slice(-2000),
            },
          })
          return {
            ok: false,
            status: 'olt_pending',
            driver: context.driverId,
            message: 'Nao foi possivel confirmar uma posicao ONU livre na PON da CTO. Registro bloqueado para evitar sobrescrita.',
          }
        }

        if (hasConfiguredOnuId && onuState.positions.occupiedPositions.includes(configuredOnuId)) {
          await logProvisioningStep(context.provisioning.id, {
            level: 'error',
            stage: 'olt.pon.position_configured_occupied',
            message: `Posicao ONU ${configuredOnuId} configurada no perfil ja esta ocupada na OLT.`,
            details: {
              command: onuState.command,
              occupiedPositions: onuState.positions.occupiedPositions,
              configuredOnuId,
            },
          })
          return {
            ok: false,
            status: 'olt_pending',
            driver: context.driverId,
            message: `A posicao ONU ${configuredOnuId} configurada no perfil ja esta ocupada na OLT. Escolha outra posicao ou remova a configuracao fixa.`,
          }
        }

        selectedOnuId = hasConfiguredOnuId ? configuredOnuId : onuState.positions.nextFreePosition
        if (!selectedOnuId) {
          await logProvisioningStep(context.provisioning.id, {
            level: 'error',
            stage: 'olt.pon.position_unavailable',
            message: 'Nenhuma posicao ONU livre foi encontrada na PON da CTO.',
            details: {
              command: onuState.command,
              occupiedPositions: onuState.positions.occupiedPositions,
              reportedOccupiedCount: onuState.positions.reportedOccupiedCount,
              reportedConfiguredCount: onuState.positions.reportedConfiguredCount,
            },
          })
          return {
            ok: false,
            status: 'olt_pending',
            driver: context.driverId,
            message: `Nenhuma posicao ONU livre foi encontrada na PON ${context.profile.chassi}/${context.profile.slot}/${context.profile.pon}.`,
          }
        }

        contextWithOnuId = {
          ...context,
          profile: {
            ...context.profile,
            onuId: selectedOnuId,
          },
        }
        await logProvisioningStep(context.provisioning.id, {
          level: 'success',
          stage: hasConfiguredOnuId ? 'olt.pon.position_configured' : 'olt.pon.position_selected',
          message: hasConfiguredOnuId
            ? `Posicao ONU ${selectedOnuId} definida pelo perfil e confirmada como livre.`
            : `Posicao ONU ${selectedOnuId} selecionada como primeira livre na PON da CTO.`,
          details: {
            chassi: context.profile.chassi,
            slot: context.profile.slot,
            pon: context.profile.pon,
            onuId: selectedOnuId,
            source: hasConfiguredOnuId ? 'profile_onu_id_verified_free' : 'first_free_olt_position',
            command: onuState.command,
            occupiedPositions: onuState.positions.occupiedPositions,
            portId: context.provisioning.port.id,
            portNumber: context.provisioning.port.number,
            ctoId: context.provisioning.port.cto.id,
            hubsoftCtoId: context.provisioning.port.cto.hubsoftId,
          },
        })
      } catch (error) {
        logOltProvisioning('registro pendente: posicao ONU nao configurada', {
          provisioningId: context.provisioning.id,
          oltDevice: context.oltDevice.name,
          chassi: context.profile.chassi,
          slot: context.profile.slot,
          pon: context.profile.pon,
        })
        await logProvisioningStep(context.provisioning.id, {
          level: 'error',
          stage: 'olt.pon.position_lookup_failed',
          message: 'Falha ao consultar posicoes livres na PON da CTO; registro bloqueado para evitar sobrescrita.',
          details: {
            oltDevice: context.oltDevice.name,
            chassi: context.profile.chassi,
            slot: context.profile.slot,
            pon: context.profile.pon,
            error: (error as Error).message,
          },
        })
        return {
          ok: false,
          status: 'olt_pending',
          driver: context.driverId,
          message: `Nao foi possivel verificar posicoes livres na PON ${context.profile.chassi}/${context.profile.slot}/${context.profile.pon}: ${(error as Error).message}`,
        }
      }
    }

    const missingRequiredVariables = validateRequiredVariables(contextWithOnuId)
    if (missingRequiredVariables.length > 0) {
      await logProvisioningStep(context.provisioning.id, {
        level: 'error',
        stage: 'olt.variables.missing',
        message: 'Perfil de ONU possui variaveis obrigatorias sem valor no contexto do provisionamento.',
        details: {
          cpeOltProfileId: contextWithOnuId.profile.cpeOltProfileId,
          profileName: contextWithOnuId.profile.name,
          missingVariables: missingRequiredVariables,
        },
      })
      return {
        ok: false,
        status: 'olt_pending',
        driver: context.driverId,
        message: `Perfil de ONU incompleto: variaveis obrigatorias sem valor (${missingRequiredVariables.join(', ')}).`,
      }
    }

    const authorizationCommands = getAuthorizationCommandTemplates(contextWithOnuId.profile)
      .map((template) => renderTemplate(template, contextWithOnuId))
      .filter(Boolean)
    const provisioningCommands = getProvisioningCommandTemplates(contextWithOnuId.profile)
      .map((template) => renderTemplate(template, contextWithOnuId))
      .filter(Boolean)
    const commands = [...authorizationCommands, ...provisioningCommands]
    const publicCommands = maskSensitiveCommands(commands)

    logOltProvisioning('comandos renderizados para registro', {
      provisioningId: context.provisioning.id,
      selectedOnuId,
      resumedFromExistingAuthorization,
      authorizationCommandCount: authorizationCommands.length,
      provisioningCommandCount: provisioningCommands.length,
      commandCount: commands.length,
      commands,
    })
    await logProvisioningStep(context.provisioning.id, {
      stage: 'olt.commands.rendered',
      message: `${commands.length} comandos de provisionamento renderizados.`,
      details: {
        selectedOnuId,
        resumedFromExistingAuthorization,
        authorizationCommands,
        provisioningCommands,
        commands,
      },
    })

    if (commands.length === 0) {
      logOltProvisioning('registro pendente: perfil sem comandos', {
        provisioningId: context.provisioning.id,
        profileName: context.profile.name,
      })
      await logProvisioningStep(context.provisioning.id, {
        level: 'warn',
        stage: 'olt.commands.empty',
        message: 'Perfil de ONU sem comandos para registro.',
        details: { profileName: context.profile.name },
      })
      return {
        ok: false,
        status: 'olt_pending',
        driver: context.driverId,
        message: 'Perfil ZTE C650 sem comandos. Configure o perfil antes de registrar na OLT.',
      }
    }

    if (shouldRunAuthorization && authorizationCommands.length > 0) {
      const authorizationResult = await runZteCommandStage({
        context: contextWithOnuId,
        commands: authorizationCommands,
        logStage: 'olt.authorization',
        startMessage: 'Executando autorizacao da ONU/CPE na OLT.',
        cliErrorMessage: 'A OLT rejeitou comandos de autorizacao',
        sshErrorMessage: 'Falha SSH ao autorizar ONU/CPE na OLT',
      })
      if (!authorizationResult.ok) {
        return {
          ok: false,
          status: 'olt_failed',
          driver: context.driverId,
          commands: publicCommands,
          message: authorizationResult.message || 'Falha ao autorizar ONU/CPE na OLT.',
        }
      }
    } else if (!shouldRunAuthorization) {
      await logProvisioningStep(context.provisioning.id, {
        level: 'success',
        stage: 'olt.authorization.skipped',
        message: 'Autorizacao ja existente na OLT; seguindo para provisionamento.',
        details: {
          selectedOnuId,
          chassi: contextWithOnuId.profile.chassi,
          slot: contextWithOnuId.profile.slot,
          pon: contextWithOnuId.profile.pon,
        },
      })
    }

    if (provisioningCommands.length === 0) {
      return {
        ok: false,
        status: 'olt_pending',
        driver: context.driverId,
        commands: publicCommands,
        message: 'ONU/CPE autorizada na OLT, mas o perfil de ONU nao possui comandos de provisionamento.',
      }
    }

    const provisioningResult = await runZteCommandStage({
      context: contextWithOnuId,
      commands: provisioningCommands,
      logStage: 'olt.provisioning',
      startMessage: 'Executando provisionamento da ONU/CPE na OLT.',
      cliErrorMessage: 'A OLT rejeitou comandos de provisionamento',
      sshErrorMessage: 'Falha SSH ao provisionar ONU/CPE na OLT',
    })
    if (!provisioningResult.ok) {
      return {
        ok: false,
        status: 'olt_pending',
        driver: context.driverId,
        commands: publicCommands,
        message: `ONU/CPE autorizada na OLT, mas o provisionamento nao foi concluido. Clique em Registrar OLT para continuar da etapa de provisionamento. Detalhe: ${provisioningResult.message || 'falha ao executar comandos de provisionamento.'}`,
      }
    }

    logOltProvisioning('registro concluido com sucesso', {
      provisioningId: context.provisioning.id,
      oltDevice: context.oltDevice.name,
      selectedOnuId,
    })
    await logProvisioningStep(context.provisioning.id, {
      level: 'success',
      stage: 'olt.registration.success',
      message: `ONU/CPE registrada via SSH na OLT ${context.oltDevice.name} na posicao ${selectedOnuId}.`,
      details: {
        oltDeviceId: context.oltDevice.id,
        oltDevice: context.oltDevice.name,
        selectedOnuId,
        chassi: Number(contextWithOnuId.profile.chassi),
        slot: Number(contextWithOnuId.profile.slot),
        pon: Number(contextWithOnuId.profile.pon),
        onuId: Number(selectedOnuId),
      },
    })
    return {
      ok: true,
      status: 'active',
      driver: context.driverId,
      commands: publicCommands,
      onuPosition: {
        oltDeviceId: context.oltDevice.id,
        chassi: Number(contextWithOnuId.profile.chassi),
        slot: Number(contextWithOnuId.profile.slot),
        pon: Number(contextWithOnuId.profile.pon),
        onuId: Number(selectedOnuId),
      },
      message: `ONU/CPE registrada via SSH na OLT ${context.oltDevice.name} na posição ${selectedOnuId}.`,
    }
  },
}

const drivers: Record<OltDriverId, OltDriver> = {
  'http-json': httpJsonDriver,
  'zte-c650': zteC650Driver,
}

export function listOltDrivers() {
  return Object.values(drivers).map((driver) => ({
    id: driver.id,
    label: driver.label,
  }))
}

export async function deprovisionProvisioningOnOlt(provisioningId: string): Promise<OltRegistrationResult> {
  logOltProvisioning('recebida solicitacao de desprovisionamento', { provisioningId })
  const provisioning = await getProvisioningContext(provisioningId)

  if (!provisioning) {
    logOltProvisioning('provisionamento nao encontrado para desprovisionamento', { provisioningId })
    return {
      ok: false,
      status: 'olt_failed',
      message: 'Provisionamento não encontrado para desprovisionar na OLT.',
    }
  }

  const operatorProfile = await getDefaultOperatorProfile(provisioning.contract.landlord.user.id)
  const initialDriverId = operatorProfile?.driver && drivers[operatorProfile.driver as OltDriverId]
    ? operatorProfile.driver as OltDriverId
    : DEFAULT_OLT_DRIVER

  if (!operatorProfile) {
    await logProvisioningStep(provisioningId, {
      level: 'error',
      stage: 'profile.missing',
      message: 'Operador sem perfil operacional associado para desprovisionar.',
      details: {
        operatorId: provisioning.contract.landlord.user.id,
        operatorName: provisioning.contract.landlord.user.name,
        operatorEmail: provisioning.contract.landlord.user.email,
      },
    })
    return {
      ok: false,
      status: 'olt_failed',
      driver: initialDriverId,
      message: 'Operador sem perfil operacional associado. Configure o perfil antes de desprovisionar a ONU/CPE na OLT.',
    }
  }

  const oltDevice = await getProvisioningOltDevice(provisioning, initialDriverId)
  let profile: OltProvisioningProfile
  try {
    profile = oltDevice
      ? await buildProfile(provisioning, oltDevice, operatorProfile)
      : await buildProfile(provisioning, null, operatorProfile)
  } catch (error) {
    if (error instanceof CpeOltCompatibilityError) {
      await logProvisioningStep(provisioningId, {
        level: 'error',
        stage: 'profile.compatibility_missing',
        message: error.message,
        details: {
          cpeModelId: provisioning.cpeModelId,
          cpeModelName: provisioning.cpeModel.name,
          oltDevice: oltDevice ? {
            id: oltDevice.id,
            name: oltDevice.name,
            manufacturer: oltDevice.manufacturer,
            model: oltDevice.model,
            driver: oltDevice.driver,
          } : null,
        },
      })
      return {
        ok: false,
        status: 'olt_pending',
        driver: initialDriverId,
        message: error.message,
      }
    }
    throw error
  }
  const driverId = profile.driver && drivers[profile.driver] ? profile.driver : DEFAULT_OLT_DRIVER
  const operatorVlan = profile.vlan ?? null

  await logProvisioningStep(provisioningId, {
    stage: 'olt.deprovision.context_loaded',
    message: 'Contexto de desprovisionamento carregado.',
    details: {
      contractNumber: provisioning.contract.contractNumber,
      driverId,
      profileName: profile.name,
      oltDevice: oltDevice?.name ?? null,
      operatorVlan,
      interface: {
        id: profile.interfaceId,
        name: profile.interfaceName,
        chassi: profile.chassi,
        slot: profile.slot,
        pon: profile.pon,
      },
    },
  })

  if (!oltDevice) {
    await logProvisioningStep(provisioningId, {
      level: 'warn',
      stage: 'olt.deprovision.device_missing',
      message: 'Nenhuma OLT ativa encontrada para desprovisionar esta ONU/CPE.',
    })
    return {
      ok: false,
      status: 'olt_pending',
      driver: driverId,
      message: 'Nenhuma OLT ativa cadastrada para desprovisionar a ONU/CPE.',
    }
  }

  if (driverId === 'http-json') {
    const context: OltProvisioningContext = {
      driverId,
      profile,
      provisioning,
      operatorVlan,
      oltDevice,
    }
    const commands = getDeprovisionCommandTemplates(profile).map((template) => renderTemplate(template, context)).filter(Boolean)
    const result = await sendToExecutor(context, {
      action: 'deprovision',
      provisioningId: provisioning.id,
      serial: provisioning.serial,
      profile,
      operatorVlan,
      cpeModel: provisioning.cpeModel,
      contract: provisioning.contract,
      cto: provisioning.port.cto,
      port: provisioning.port,
    }, commands)
    return result.ok
      ? {
          ...result,
          status: 'inactive',
          message: 'ONU/CPE desprovisionada na OLT com sucesso.',
        }
      : result
  }

  let matchedPosition: { chassi: number; slot: number; pon: number; onuId: number } | null = null
  try {
    await logProvisioningStep(provisioningId, {
      stage: 'olt.deprovision.serial_lookup_started',
      message: 'Consultando ONU/CPE por serial antes de desprovisionar.',
      details: { serial: provisioning.serial, oltDevice: oltDevice.name },
    })
    const lookup = await queryOltOnuBySerial(oltDevice, provisioning.serial)
    await logProvisioningStep(provisioningId, {
      level: lookup.exists ? 'success' : 'warn',
      stage: 'olt.deprovision.serial_lookup_finished',
      message: lookup.exists
        ? 'ONU/CPE encontrada na OLT para desprovisionamento.'
        : 'ONU/CPE nao encontrada na OLT para desprovisionamento.',
      details: {
        command: lookup.command,
        exists: lookup.exists,
        recognizedOutput: lookup.isRecognizedOutput,
        matchedLines: lookup.matchedLines,
        matchedPosition: lookup.matchedPosition,
      },
    })

    if (!lookup.isRecognizedOutput) {
      return {
        ok: false,
        status: 'olt_failed',
        driver: driverId,
        message: `A OLT ${oltDevice.name} não retornou uma resposta reconhecida para localizar o serial ${provisioning.serial}.`,
      }
    }

    if (!lookup.exists) {
      return {
        ok: false,
        status: 'olt_failed',
        driver: driverId,
        message: `A ONU/CPE com serial ${provisioning.serial} não foi encontrada na OLT ${oltDevice.name}.`,
      }
    }

    if (!lookup.matchedPosition) {
      return {
        ok: false,
        status: 'olt_failed',
        driver: driverId,
        message: `A ONU/CPE ${provisioning.serial} foi encontrada na OLT ${oltDevice.name}, mas a posição chassi/slot/PON/ONU não pôde ser identificada no retorno.`,
      }
    }

    matchedPosition = lookup.matchedPosition
  } catch (error) {
    await logProvisioningStep(provisioningId, {
      level: 'error',
      stage: 'olt.deprovision.serial_lookup_failed',
      message: 'Falha ao consultar ONU/CPE por serial antes de desprovisionar.',
      details: {
        oltDevice: oltDevice.name,
        serial: provisioning.serial,
        error: (error as Error).message,
      },
    })
    return {
      ok: false,
      status: 'olt_failed',
      driver: driverId,
      message: `Falha ao localizar ONU/CPE ${provisioning.serial} na OLT ${oltDevice.name}: ${(error as Error).message}`,
    }
  }

  const context: OltProvisioningContext = {
    driverId,
    profile: {
      ...profile,
      chassi: matchedPosition.chassi,
      slot: matchedPosition.slot,
      pon: matchedPosition.pon,
      onuId: matchedPosition.onuId,
    },
    provisioning,
    operatorVlan,
    oltDevice,
  }
  const missingRequiredVariables = validateRequiredVariables(context)
  if (missingRequiredVariables.length > 0) {
    await logProvisioningStep(provisioningId, {
      level: 'error',
      stage: 'olt.deprovision.variables_missing',
      message: 'Perfil de ONU possui variaveis obrigatorias sem valor no contexto do desprovisionamento.',
      details: {
        cpeOltProfileId: context.profile.cpeOltProfileId,
        profileName: context.profile.name,
        missingVariables: missingRequiredVariables,
      },
    })
    return {
      ok: false,
      status: 'olt_pending',
      driver: driverId,
      message: `Perfil de ONU incompleto: variaveis obrigatorias sem valor (${missingRequiredVariables.join(', ')}).`,
    }
  }
  const deprovisionCommandTemplates = getDeprovisionCommandTemplates(context.profile)
  const commands = deprovisionCommandTemplates.map((template) => renderTemplate(template, context)).filter(Boolean)

  await logProvisioningStep(provisioningId, {
    stage: 'olt.deprovision.commands_rendered',
    message: `${commands.length} comandos de desprovisionamento renderizados.`,
    details: {
      matchedPosition,
      commands,
    },
  })

  if (commands.length === 0) {
    await logProvisioningStep(provisioningId, {
      level: 'warn',
      stage: 'olt.deprovision.commands_empty',
      message: 'Perfil de ONU sem comandos de desprovisionamento.',
      details: { profileName: profile.name },
    })
    return {
      ok: false,
      status: 'olt_pending',
      driver: driverId,
      message: 'Perfil sem comandos de desprovisionamento. Configure os comandos antes de remover a ONU/CPE da OLT.',
    }
  }

  try {
    await logProvisioningStep(provisioningId, {
      stage: 'olt.deprovision.ssh_started',
      message: 'Enviando comandos de desprovisionamento por SSH.',
      details: {
        oltDevice: oltDevice.name,
        commandCount: commands.length,
        matchedPosition,
      },
    })
    const result = await executeOltCommandsOverSsh(oltDevice, commands, {
      allowPartialOnDisconnect: true,
      stopOnCliError: true,
      exitCommands: splitOperationalCommands(oltDevice.exitCommands),
    })
    const cliErrors = getOltCliErrors(`${result.output}\n${result.stderr}`)
    if (cliErrors.length > 0) {
      await logProvisioningStep(provisioningId, {
        level: 'error',
        stage: 'olt.deprovision.ssh_cli_error',
        message: 'A OLT rejeitou comandos de desprovisionamento.',
        details: {
          oltDevice: oltDevice.name,
          errors: cliErrors,
        },
      })
      const completedResult = await confirmDeprovisionCompletedBySerialAbsence({
        provisioningId,
        provisioning,
        oltDevice,
        driverId,
        commands,
        reason: `CLI error: ${cliErrors.slice(0, 3).join(' | ')}`,
      })
      if (completedResult) {
        return completedResult
      }
      return {
        ok: false,
        status: 'olt_failed',
        driver: driverId,
        commands,
        message: `A OLT rejeitou comandos de desprovisionamento: ${cliErrors.slice(0, 3).join(' | ')}`,
      }
    }
  } catch (error) {
    await logProvisioningStep(provisioningId, {
      level: 'error',
      stage: 'olt.deprovision.ssh_failed',
      message: 'Falha SSH ao desprovisionar ONU/CPE na OLT.',
      details: {
        oltDevice: oltDevice.name,
        error: (error as Error).message,
      },
    })
    const completedResult = await confirmDeprovisionCompletedBySerialAbsence({
      provisioningId,
      provisioning,
      oltDevice,
      driverId,
      commands,
      reason: `SSH error: ${(error as Error).message}`,
    })
    if (completedResult) {
      return completedResult
    }
    return {
      ok: false,
      status: 'olt_failed',
      driver: driverId,
      commands,
      message: `Falha SSH ao desprovisionar ONU/CPE na OLT ${oltDevice.name}: ${(error as Error).message}`,
    }
  }

  await logProvisioningStep(provisioningId, {
    level: 'success',
    stage: 'olt.deprovision.success',
    message: `ONU/CPE removida via SSH da OLT ${oltDevice.name}.`,
    details: {
      oltDevice: oltDevice.name,
      matchedPosition,
    },
  })

  return {
    ok: true,
    status: 'inactive',
    driver: driverId,
    commands,
    message: `ONU/CPE removida via SSH da OLT ${oltDevice.name}.`,
  }
}

export async function registerProvisioningOnOlt(provisioningId: string): Promise<OltRegistrationResult> {
  logOltProvisioning('recebida solicitacao de registro', { provisioningId })
  const provisioning = await getProvisioningContext(provisioningId)

  if (!provisioning) {
    logOltProvisioning('provisionamento nao encontrado', { provisioningId })
    return {
      ok: false,
      status: 'olt_failed',
      message: 'Provisionamento não encontrado para registro na OLT.',
    }
  }

  const operatorProfile = await getDefaultOperatorProfile(provisioning.contract.landlord.user.id)
  const initialDriverId = operatorProfile?.driver && drivers[operatorProfile.driver as OltDriverId]
    ? operatorProfile.driver as OltDriverId
    : DEFAULT_OLT_DRIVER

  if (!operatorProfile) {
    logOltProvisioning('registro bloqueado: operador sem perfil operacional', {
      provisioningId,
      operatorId: provisioning.contract.landlord.user.id,
      operatorName: provisioning.contract.landlord.user.name,
    })
    await logProvisioningStep(provisioningId, {
      level: 'error',
      stage: 'profile.missing',
      message: 'Operador sem perfil operacional associado.',
      details: {
        operatorId: provisioning.contract.landlord.user.id,
        operatorName: provisioning.contract.landlord.user.name,
        operatorEmail: provisioning.contract.landlord.user.email,
      },
    })
    return {
      ok: false,
      status: 'olt_failed',
      message: 'Operador sem perfil operacional associado. Cadastre um perfil operacional antes de registrar a ONU/CPE na OLT.',
    }
  }

  const oltDevice = await getProvisioningOltDevice(provisioning, initialDriverId)
  let profile: OltProvisioningProfile
  try {
    profile = oltDevice
      ? await buildProfile(provisioning, oltDevice, operatorProfile)
      : await buildProfile(provisioning, null, operatorProfile)
  } catch (error) {
    if (error instanceof CpeOltCompatibilityError) {
      await logProvisioningStep(provisioningId, {
        level: 'error',
        stage: 'profile.compatibility_missing',
        message: error.message,
        details: {
          cpeModelId: provisioning.cpeModelId,
          cpeModelName: provisioning.cpeModel.name,
          oltDevice: oltDevice ? {
            id: oltDevice.id,
            name: oltDevice.name,
            manufacturer: oltDevice.manufacturer,
            model: oltDevice.model,
            driver: oltDevice.driver,
          } : null,
        },
      })
      return {
        ok: false,
        status: 'olt_pending',
        driver: initialDriverId,
        message: error.message,
      }
    }
    throw error
  }
  const driverId = profile.driver && drivers[profile.driver] ? profile.driver : DEFAULT_OLT_DRIVER
  const driver = drivers[driverId] || zteC650Driver
  const operatorVlan = profile.vlan ?? null
  const serialCheck = await checkSerialAvailableOnOlt(provisioning.portId, provisioning.serial, driverId)
  const canResumeExistingOltAuthorization = serialCheck.exists
    && ['inactive', 'olt_failed', 'olt_pending'].includes(provisioning.status)
  await logProvisioningStep(provisioningId, {
    level: serialCheck.ok ? 'success' : canResumeExistingOltAuthorization ? 'warn' : 'error',
    stage: 'olt.serial.precheck',
    message: canResumeExistingOltAuthorization
      ? 'Serial encontrado na OLT e provisionamento local esta inativo/pendente/com falha; o registro sera retomado da etapa de provisionamento.'
      : serialCheck.message,
    details: {
      checked: serialCheck.checked,
      exists: serialCheck.exists,
      command: serialCheck.command,
      oltDevice: serialCheck.oltDevice,
      matchedLines: serialCheck.matchedLines,
      matchedPosition: serialCheck.matchedPosition,
    },
  })
  if (!serialCheck.ok && !canResumeExistingOltAuthorization) {
    return {
      ok: false,
      status: 'olt_failed',
      driver: driverId,
      message: serialCheck.message,
    }
  }
  logOltProvisioning('contexto carregado', {
    provisioningId,
    contractNumber: provisioning.contract.contractNumber,
    initialDriverId,
    driverId,
    oltDevice: oltDevice?.name ?? null,
    operatorVlan,
    interface: {
      id: profile.interfaceId,
      name: profile.interfaceName,
      chassi: profile.chassi,
      slot: profile.slot,
      pon: profile.pon,
    },
  })
  await logProvisioningStep(provisioningId, {
    stage: 'olt.context.loaded',
    message: 'Contexto de provisionamento carregado.',
    details: {
      contractNumber: provisioning.contract.contractNumber,
      driverId,
      profileName: profile.name,
      oltDevice: oltDevice?.name ?? null,
      operatorVlan,
      interface: {
        id: profile.interfaceId,
        name: profile.interfaceName,
        chassi: profile.chassi,
        slot: profile.slot,
        pon: profile.pon,
      },
    },
  })

  return driver.register({
    driverId: driver.id,
    profile,
    provisioning,
    operatorVlan,
    oltDevice,
  })
}
