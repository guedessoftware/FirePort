import { decryptAuthSecret, encryptAuthSecret } from './auth-security'
import { getCompatibleCpeModelOltProfile } from './cpe-model-olt-profiles'
import { prisma } from './prisma'
import { addProvisioningLog } from './provisioning-logs'

const GENIEACS_SETTINGS_KEY = 'genieAcsIntegration'
const DEFAULT_SERIAL_PARAMETER = 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_GPONSN'
const DEFAULT_WIFI_SSID_PARAMETER = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'
const LEGACY_WIFI_PASSWORD_PARAMETER = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey'
const DEFAULT_WIFI_PASSWORD_PARAMETER = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase'
const DEFAULT_WIFI_5G_SSID_PARAMETER = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID'
const LEGACY_WIFI_5G_PASSWORD_PARAMETER = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey'
const DEFAULT_WIFI_5G_PASSWORD_PARAMETER = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase'
const DEFAULT_HOSTS_OBJECT_PATH = 'InternetGatewayDevice.LANDevice.1.Hosts.Host'
const ZTE_WIFI_24_ASSOCIATED_DEVICE_PATH = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice'
const ZTE_WIFI_5_ASSOCIATED_DEVICE_PATH = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice'

export type GenieAcsSettingsPublic = {
  enabled: boolean
  baseUrl: string
  authHeaderName: string
  authHeaderValueSet: boolean
  serialParameter: string
  wifiSsidParameter: string
  wifiPasswordParameter: string
  wifi5SsidParameter: string
  wifi5PasswordParameter: string
  hostsObjectPath: string
  connectionRequest: boolean
  connectionRequestTimeoutMs: number
  provisioningWaitSeconds: number
  lastConnectionStatus: string | null
  lastConnectionTestAt: string | null
  lastError: string | null
}

type GenieAcsSettingsSecret = GenieAcsSettingsPublic & {
  authHeaderValue: string | null
}

type GenieAcsRuntimeSettings = GenieAcsSettingsSecret & {
  wifi24AssociatedDevicePath: string
  wifi5AssociatedDevicePath: string
}

type GenieAcsDevice = Record<string, unknown> & {
  _id?: string
  _lastInform?: string
}

export type GenieAcsDeviceSummary = {
  id: string
  serial: string | null
  serialParameter: string
  manufacturer: string | null
  modelName: string | null
  productClass: string | null
  oui: string | null
  lastInformAt: string | null
}

export type GenieAcsConnectedDevice = {
  index: string
  hostName: string | null
  ipAddress: string | null
  macAddress: string | null
  interfaceType: string | null
  addressSource: string | null
  active: boolean | null
  leaseTimeRemaining: string | null
  wifiBand?: string | null
  clientMode?: string | null
  rssi?: string | null
  bandwidth?: string | null
  rate?: string | null
  noise?: string | null
  uptime?: string | null
  rxBytes?: string | null
  txBytes?: string | null
  authenticationState?: string | null
}

export type GenieAcsWifiInfo = {
  band24: {
    ssid: string | null
    password: string | null
  }
  band5: {
    ssid: string | null
    password: string | null
  }
}

const DEFAULT_SETTINGS: GenieAcsSettingsPublic = {
  enabled: false,
  baseUrl: '',
  authHeaderName: 'Authorization',
  authHeaderValueSet: false,
  serialParameter: DEFAULT_SERIAL_PARAMETER,
  wifiSsidParameter: DEFAULT_WIFI_SSID_PARAMETER,
  wifiPasswordParameter: DEFAULT_WIFI_PASSWORD_PARAMETER,
  wifi5SsidParameter: DEFAULT_WIFI_5G_SSID_PARAMETER,
  wifi5PasswordParameter: DEFAULT_WIFI_5G_PASSWORD_PARAMETER,
  hostsObjectPath: DEFAULT_HOSTS_OBJECT_PATH,
  connectionRequest: true,
  connectionRequestTimeoutMs: 10000,
  provisioningWaitSeconds: 45,
  lastConnectionStatus: null,
  lastConnectionTestAt: null,
  lastError: null,
}

const DEFAULT_PARAMETER_MAP = {
  serialParameter: DEFAULT_SERIAL_PARAMETER,
  wifiSsidParameter: DEFAULT_WIFI_SSID_PARAMETER,
  wifiPasswordParameter: DEFAULT_WIFI_PASSWORD_PARAMETER,
  wifi5SsidParameter: DEFAULT_WIFI_5G_SSID_PARAMETER,
  wifi5PasswordParameter: DEFAULT_WIFI_5G_PASSWORD_PARAMETER,
  hostsObjectPath: DEFAULT_HOSTS_OBJECT_PATH,
  wifi24AssociatedDevicePath: ZTE_WIFI_24_ASSOCIATED_DEVICE_PATH,
  wifi5AssociatedDevicePath: ZTE_WIFI_5_ASSOCIATED_DEVICE_PATH,
}

function normalizeBaseUrl(value: unknown) {
  const input = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!input) return ''
  return /^https?:\/\//i.test(input) ? input : `http://${input}`
}

function normalizeParameterPath(value: unknown, fallback: string) {
  const input = typeof value === 'string' ? value.trim().replace(/\.+$/, '') : ''
  return input || fallback
}

function normalizeWifiPasswordParameter(value: unknown) {
  const normalized = normalizeParameterPath(value, DEFAULT_SETTINGS.wifiPasswordParameter)
  return normalized === LEGACY_WIFI_PASSWORD_PARAMETER ? DEFAULT_SETTINGS.wifiPasswordParameter : normalized
}

function normalizeWifi5PasswordParameter(value: unknown) {
  const normalized = normalizeParameterPath(value, DEFAULT_SETTINGS.wifi5PasswordParameter)
  return normalized === LEGACY_WIFI_5G_PASSWORD_PARAMETER ? DEFAULT_SETTINGS.wifi5PasswordParameter : normalized
}

function normalizeHeaderName(value: unknown) {
  const input = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9-]+$/.test(input) ? input : DEFAULT_SETTINGS.authHeaderName
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function parseJsonObject(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function decryptOptional(value: unknown) {
  if (typeof value !== 'string' || !value) return null
  try {
    return decryptAuthSecret(value)
  } catch {
    return null
  }
}

async function readStoredSettings() {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${GENIEACS_SETTINGS_KEY} LIMIT 1
  `
  return parseJsonObject(rows[0]?.value ?? null)
}

async function writeStoredSettings(value: Record<string, unknown>) {
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" (
      "id",
      "key",
      "value",
      "createdAt",
      "updatedAt"
    ) VALUES (
      lower(hex(randomblob(16))),
      ${GENIEACS_SETTINGS_KEY},
      ${JSON.stringify(value)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT("key") DO UPDATE SET
      "value" = excluded."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `
}

function publicFromStored(stored: Record<string, unknown>): GenieAcsSettingsPublic {
  const lastConnectionTestAt = typeof stored.lastConnectionTestAt === 'string' ? stored.lastConnectionTestAt : null

  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    baseUrl: normalizeBaseUrl(stored.baseUrl),
    authHeaderName: normalizeHeaderName(stored.authHeaderName),
    authHeaderValueSet: typeof stored.authHeaderValueEncrypted === 'string' && stored.authHeaderValueEncrypted.length > 0,
    serialParameter: normalizeParameterPath(stored.serialParameter, DEFAULT_SETTINGS.serialParameter),
    wifiSsidParameter: normalizeParameterPath(stored.wifiSsidParameter, DEFAULT_SETTINGS.wifiSsidParameter),
    wifiPasswordParameter: normalizeWifiPasswordParameter(stored.wifiPasswordParameter),
    wifi5SsidParameter: normalizeParameterPath(stored.wifi5SsidParameter, DEFAULT_SETTINGS.wifi5SsidParameter),
    wifi5PasswordParameter: normalizeWifi5PasswordParameter(stored.wifi5PasswordParameter),
    hostsObjectPath: normalizeParameterPath(stored.hostsObjectPath, DEFAULT_SETTINGS.hostsObjectPath),
    connectionRequest: typeof stored.connectionRequest === 'boolean' ? stored.connectionRequest : DEFAULT_SETTINGS.connectionRequest,
    connectionRequestTimeoutMs: normalizeInteger(stored.connectionRequestTimeoutMs, DEFAULT_SETTINGS.connectionRequestTimeoutMs, 1000, 60000),
    provisioningWaitSeconds: normalizeInteger(stored.provisioningWaitSeconds, DEFAULT_SETTINGS.provisioningWaitSeconds, 0, 180),
    lastConnectionStatus: typeof stored.lastConnectionStatus === 'string' ? stored.lastConnectionStatus : null,
    lastConnectionTestAt,
    lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
  }
}

async function getSecretSettings(): Promise<GenieAcsSettingsSecret> {
  const stored = await readStoredSettings()
  return {
    ...publicFromStored(stored),
    authHeaderValue: decryptOptional(stored.authHeaderValueEncrypted),
  }
}

function parseParameterMap(value?: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function runtimeSettingsFromMap(settings: GenieAcsSettingsSecret, map: Record<string, unknown>): GenieAcsRuntimeSettings {
  return {
    ...settings,
    serialParameter: normalizeParameterPath(map.serialParameter ?? settings.serialParameter, DEFAULT_PARAMETER_MAP.serialParameter),
    wifiSsidParameter: normalizeParameterPath(map.wifiSsidParameter ?? settings.wifiSsidParameter, DEFAULT_PARAMETER_MAP.wifiSsidParameter),
    wifiPasswordParameter: normalizeWifiPasswordParameter(map.wifiPasswordParameter ?? settings.wifiPasswordParameter),
    wifi5SsidParameter: normalizeParameterPath(map.wifi5SsidParameter ?? settings.wifi5SsidParameter, DEFAULT_PARAMETER_MAP.wifi5SsidParameter),
    wifi5PasswordParameter: normalizeWifi5PasswordParameter(map.wifi5PasswordParameter ?? settings.wifi5PasswordParameter),
    hostsObjectPath: normalizeParameterPath(map.hostsObjectPath ?? settings.hostsObjectPath, DEFAULT_PARAMETER_MAP.hostsObjectPath),
    wifi24AssociatedDevicePath: normalizeParameterPath(map.wifi24AssociatedDevicePath, DEFAULT_PARAMETER_MAP.wifi24AssociatedDevicePath),
    wifi5AssociatedDevicePath: normalizeParameterPath(map.wifi5AssociatedDevicePath, DEFAULT_PARAMETER_MAP.wifi5AssociatedDevicePath),
  }
}

async function getGenieAcsRuntimeSettings(provisioningId?: string | null): Promise<GenieAcsRuntimeSettings> {
  const settings = await getSecretSettings()
  if (!provisioningId) {
    return runtimeSettingsFromMap(settings, {})
  }

  const rows = await prisma.$queryRaw<Array<{
    cpeModelId: string
    oltManufacturer: string | null
    oltModel: string | null
    oltDriver: string | null
  }>>`
    SELECT
      "Provisioning"."cpeModelId" AS "cpeModelId",
      "OltDevice"."manufacturer" AS "oltManufacturer",
      "OltDevice"."model" AS "oltModel",
      "OltDevice"."driver" AS "oltDriver"
    FROM "Provisioning"
    INNER JOIN "Port" ON "Port"."id" = "Provisioning"."portId"
    INNER JOIN "CTO" ON "CTO"."id" = "Port"."ctoId"
    LEFT JOIN "OltInterface" ON "OltInterface"."id" = "CTO"."oltInterfaceId"
    LEFT JOIN "OltDevice" ON "OltDevice"."id" = "OltInterface"."oltDeviceId"
    WHERE "Provisioning"."id" = ${provisioningId}
    LIMIT 1
  `

  const provisioning = rows[0]
  const cpeOltProfile = provisioning
    ? await getCompatibleCpeModelOltProfile(provisioning.cpeModelId, {
      manufacturer: provisioning.oltManufacturer,
      model: provisioning.oltModel,
      driver: provisioning.oltDriver,
    })
    : null
  const map = parseParameterMap(cpeOltProfile?.genieAcsParameterMapJson ?? null)
  return runtimeSettingsFromMap(settings, map)
}

export async function getGenieAcsSettingsPublic() {
  return publicFromStored(await readStoredSettings())
}

export async function saveGenieAcsSettings(input: Partial<GenieAcsSettingsPublic> & { authHeaderValue?: string | null }) {
  const stored = await readStoredSettings()
  const current = publicFromStored(stored)
  const authHeaderValueEncrypted = typeof input.authHeaderValue === 'string' && input.authHeaderValue.trim()
    ? encryptAuthSecret(input.authHeaderValue.trim())
    : input.authHeaderValue === null
      ? null
      : stored.authHeaderValueEncrypted ?? null
  const next = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    baseUrl: normalizeBaseUrl(input.baseUrl ?? current.baseUrl),
    authHeaderName: normalizeHeaderName(input.authHeaderName ?? current.authHeaderName),
    authHeaderValueEncrypted,
    serialParameter: normalizeParameterPath(input.serialParameter ?? current.serialParameter, DEFAULT_SETTINGS.serialParameter),
    wifiSsidParameter: normalizeParameterPath(input.wifiSsidParameter ?? current.wifiSsidParameter, DEFAULT_SETTINGS.wifiSsidParameter),
    wifiPasswordParameter: normalizeWifiPasswordParameter(input.wifiPasswordParameter ?? current.wifiPasswordParameter),
    wifi5SsidParameter: normalizeParameterPath(input.wifi5SsidParameter ?? current.wifi5SsidParameter, DEFAULT_SETTINGS.wifi5SsidParameter),
    wifi5PasswordParameter: normalizeWifi5PasswordParameter(input.wifi5PasswordParameter ?? current.wifi5PasswordParameter),
    hostsObjectPath: normalizeParameterPath(input.hostsObjectPath ?? current.hostsObjectPath, DEFAULT_SETTINGS.hostsObjectPath),
    connectionRequest: typeof input.connectionRequest === 'boolean' ? input.connectionRequest : current.connectionRequest,
    connectionRequestTimeoutMs: normalizeInteger(input.connectionRequestTimeoutMs, current.connectionRequestTimeoutMs, 1000, 60000),
    provisioningWaitSeconds: normalizeInteger(input.provisioningWaitSeconds, current.provisioningWaitSeconds, 0, 180),
    lastConnectionStatus: current.lastConnectionStatus,
    lastConnectionTestAt: current.lastConnectionTestAt,
    lastError: current.lastError,
  }

  if (next.enabled && !next.baseUrl) {
    throw new Error('Informe a URL do GenieACS antes de ativar a integração.')
  }

  await writeStoredSettings(next)
  return getGenieAcsSettingsPublic()
}

async function saveConnectionStatus(ok: boolean, error?: string | null) {
  const stored = await readStoredSettings()
  await writeStoredSettings({
    ...stored,
    lastConnectionStatus: ok ? 'ok' : 'error',
    lastConnectionTestAt: new Date().toISOString(),
    lastError: error ?? null,
  })
}

function headersFor(settings: GenieAcsSettingsSecret, json = false) {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (settings.authHeaderValue) {
    headers[settings.authHeaderName] = settings.authHeaderValue
  }
  return headers
}

function networkErrorMessage(error: unknown, targetUrl: string) {
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: { code?: string; syscall?: string; address?: string; port?: number; message?: string } }).cause
    : null
  const code = cause?.code ? ` (${cause.code})` : ''
  const detail = cause?.message || (error instanceof Error ? error.message : String(error))
  return `Não foi possível conectar ao GenieACS em ${targetUrl}${code}. Verifique se a URL aponta para o NBI do GenieACS, normalmente porta 7557, e se este servidor consegue acessar o host. Detalhe: ${detail}`
}

async function genieAcsFetch(settings: GenieAcsSettingsSecret, path: string, init: RequestInit = {}) {
  if (!settings.baseUrl) {
    throw new Error('GenieACS sem URL configurada.')
  }

  const targetUrl = `${settings.baseUrl}${path}`
  let response: Response
  try {
    response = await fetch(targetUrl, {
      ...init,
      cache: 'no-store',
      headers: {
        ...headersFor(settings, Boolean(init.body)),
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  } catch (error) {
    throw new Error(networkErrorMessage(error, settings.baseUrl))
  }
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!response.ok) {
    const genieAcsVersion = response.headers.get('genieacs-version')
    if (response.status === 404 && genieAcsVersion) {
      throw new Error(
        `A URL ${settings.baseUrl} respondeu como GenieACS UI (${genieAcsVersion}), mas não como NBI: /devices retornou 404. Configure a URL do NBI do GenieACS, normalmente http://HOST:7557, ou libere essa porta para o servidor do FirePort.`,
      )
    }
    throw new Error(`GenieACS respondeu ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }

  return { response, body }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function queryString(params: Record<string, string>) {
  return new URLSearchParams(params).toString()
}

function unwrapValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && '_value' in value) {
    return (value as { _value?: unknown })._value
  }
  return value
}

function valueAsString(value: unknown) {
  const unwrapped = unwrapValue(value)
  if (unwrapped === null || unwrapped === undefined) return null
  return String(unwrapped)
}

function valueAsBoolean(value: unknown) {
  const unwrapped = unwrapValue(value)
  if (typeof unwrapped === 'boolean') return unwrapped
  if (typeof unwrapped === 'number') return unwrapped !== 0
  if (typeof unwrapped === 'string') {
    if (/^(true|1|yes)$/i.test(unwrapped)) return true
    if (/^(false|0|no)$/i.test(unwrapped)) return false
  }
  return null
}

const WIFI_PASSWORD_POLICY_MESSAGE = 'A senha do Wi-Fi deve ter no minimo 8 caracteres, com letra maiuscula, minuscula, numero e caractere especial.'
const WIFI_SSID_POLICY_MESSAGE = 'O nome do Wi-Fi deve usar apenas letras, numeros e os caracteres especiais permitidos: : - _.'

function getWifiSsidPolicyError(ssid: string) {
  const cleanSsid = ssid.trim()
  if (!cleanSsid) return null
  return /^[A-Za-z0-9:_-]+$/.test(cleanSsid) ? null : WIFI_SSID_POLICY_MESSAGE
}

function getWifiPasswordPolicyError(password: string) {
  if (!password) return null
  if (
    password.length < 8
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/\d/.test(password)
    || !/[^A-Za-z0-9\s]/.test(password)
  ) {
    return WIFI_PASSWORD_POLICY_MESSAGE
  }

  return null
}

function getPathRaw(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined
  const object = source as Record<string, unknown>
  if (path in object) return object[path]

  let current: unknown = object
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function getPathValue(source: unknown, path: string) {
  return unwrapValue(getPathRaw(source, path))
}

function parseLastInform(value: unknown) {
  const text = valueAsString(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function summarizeDevice(device: GenieAcsDevice, serialParameter: string): GenieAcsDeviceSummary | null {
  const id = typeof device._id === 'string' ? device._id : null
  if (!id) return null

  return {
    id,
    serial: valueAsString(getPathValue(device, serialParameter)),
    serialParameter,
    manufacturer: valueAsString(getPathValue(device, 'InternetGatewayDevice.DeviceInfo.Manufacturer')) ?? valueAsString(getPathValue(device, 'DeviceID.Manufacturer')),
    modelName: valueAsString(getPathValue(device, 'InternetGatewayDevice.DeviceInfo.ModelName')),
    productClass: valueAsString(getPathValue(device, 'DeviceID.ProductClass')),
    oui: valueAsString(getPathValue(device, 'DeviceID.OUI')),
    lastInformAt: parseLastInform(device._lastInform),
  }
}

async function getDeviceById(settings: GenieAcsSettingsSecret, deviceId: string, projection?: string[]) {
  const params: Record<string, string> = { query: JSON.stringify({ _id: deviceId }) }
  if (projection?.length) params.projection = projection.join(',')
  const result = await genieAcsFetch(settings, `/devices?${queryString(params)}`)
  const devices = Array.isArray(result.body) ? result.body as GenieAcsDevice[] : []
  return devices[0] ?? null
}

export async function findGenieAcsDeviceBySerial(serial: string, provisioningId?: string | null) {
  const settings = await getGenieAcsRuntimeSettings(provisioningId)
  if (!settings.enabled) return { settings, device: null, summary: null }

  const cleanSerial = serial.trim()
  const serialParameter = settings.serialParameter
  const query = {
    $or: [
      { [serialParameter]: cleanSerial },
      { [`${serialParameter}._value`]: cleanSerial },
      { [serialParameter]: { $regex: `^${escapeRegex(cleanSerial)}$`, $options: 'i' } },
      { [`${serialParameter}._value`]: { $regex: `^${escapeRegex(cleanSerial)}$`, $options: 'i' } },
    ],
  }
  const projection = [
    serialParameter,
    'DeviceID',
    'InternetGatewayDevice.DeviceInfo',
    '_lastInform',
  ].join(',')
  const result = await genieAcsFetch(settings, `/devices?${queryString({ query: JSON.stringify(query), projection })}`)
  const devices = Array.isArray(result.body) ? result.body as GenieAcsDevice[] : []
  const device = devices.sort((left, right) =>
    new Date(valueAsString(right._lastInform) ?? 0).getTime() - new Date(valueAsString(left._lastInform) ?? 0).getTime()
  )[0] ?? null
  const summary = device ? summarizeDevice(device, serialParameter) : null
  return { settings, device, summary }
}

function summaryJson(summary: GenieAcsDeviceSummary) {
  return JSON.stringify({
    manufacturer: summary.manufacturer,
    modelName: summary.modelName,
    productClass: summary.productClass,
    oui: summary.oui,
    serial: summary.serial,
  })
}

export async function attachGenieAcsDeviceToProvisioning(provisioningId: string, serial: string) {
  const { settings, summary } = await findGenieAcsDeviceBySerial(serial, provisioningId)
  if (!settings.enabled || !summary) {
    return { ok: false, skipped: !settings.enabled, summary: null, message: settings.enabled ? 'CPE nao encontrada no GenieACS.' : 'Integração GenieACS desativada.' }
  }

  await prisma.$executeRaw`
    UPDATE "Provisioning"
    SET "genieAcsDeviceId" = ${summary.id},
        "genieAcsSerialParameter" = ${summary.serialParameter},
        "genieAcsLinkedAt" = CURRENT_TIMESTAMP,
        "genieAcsLastInformAt" = ${summary.lastInformAt ? new Date(summary.lastInformAt) : null},
        "genieAcsLastSyncAt" = CURRENT_TIMESTAMP,
        "genieAcsSummaryJson" = ${summaryJson(summary)}
    WHERE "id" = ${provisioningId}
  `

  return { ok: true, skipped: false, summary, message: `CPE associada no GenieACS: ${summary.id}.` }
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function attachGenieAcsDeviceAfterProvisioning(provisioningId: string, serial: string) {
  const settings = await getGenieAcsRuntimeSettings(provisioningId)
  if (!settings.enabled) {
    return { ok: false, skipped: true, summary: null, message: 'Integração GenieACS desativada.' }
  }

  const attempts = Math.max(1, Math.floor(settings.provisioningWaitSeconds / 5) + 1)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await attachGenieAcsDeviceToProvisioning(provisioningId, serial)
    if (result.ok || result.skipped) {
      await addProvisioningLog({
        provisioningId,
        level: result.ok ? 'success' : 'warn',
        stage: 'genieacs.association_finished',
        message: result.message,
        details: { attempt, summary: result.summary },
      })
      return result
    }

    if (attempt < attempts) {
      await wait(5000)
    }
  }

  const message = `CPE ${serial} nao apareceu ativa no GenieACS dentro de ${settings.provisioningWaitSeconds}s.`
  await addProvisioningLog({
    provisioningId,
    level: 'warn',
    stage: 'genieacs.association_pending',
    message,
    details: { serial, serialParameter: settings.serialParameter },
  })
  return { ok: false, skipped: false, summary: null, message }
}

async function postTask(settings: GenieAcsSettingsSecret, deviceId: string, task: Record<string, unknown>) {
  const params = new URLSearchParams()
  params.set('timeout', String(settings.connectionRequestTimeoutMs))
  if (settings.connectionRequest) params.set('connection_request', '')
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?${params.toString()}`
  const result = await genieAcsFetch(settings, path, {
    method: 'POST',
    body: JSON.stringify(task),
  })

  return {
    queued: result.response.status === 202,
    task: result.body,
  }
}

async function ensureProvisioningDevice(provisioning: { id: string; serial: string; genieAcsDeviceId?: string | null }) {
  const settings = await getGenieAcsRuntimeSettings(provisioning.id)
  if (!settings.enabled) {
    throw new Error('Integração GenieACS desativada.')
  }

  if (provisioning.genieAcsDeviceId) {
    return { settings, deviceId: provisioning.genieAcsDeviceId }
  }

  const result = await attachGenieAcsDeviceToProvisioning(provisioning.id, provisioning.serial)
  if (!result.ok || !result.summary) {
    throw new Error(result.message)
  }

  return { settings, deviceId: result.summary.id }
}

function parseHosts(device: GenieAcsDevice, hostsObjectPath: string): GenieAcsConnectedDevice[] {
  const rawHosts = getPathRaw(device, hostsObjectPath)
  if (!rawHosts || typeof rawHosts !== 'object') return []

  return Object.entries(rawHosts as Record<string, unknown>)
    .filter(([index, value]) => /^\d+$/.test(index) && value && typeof value === 'object')
    .map(([index, value]) => ({
      index,
      hostName: valueAsString(getPathValue(value, 'HostName')),
      ipAddress: valueAsString(getPathValue(value, 'IPAddress')),
      macAddress: valueAsString(getPathValue(value, 'MACAddress')),
      interfaceType: valueAsString(getPathValue(value, 'InterfaceType')),
      addressSource: valueAsString(getPathValue(value, 'AddressSource')),
      active: valueAsBoolean(getPathValue(value, 'Active')),
      leaseTimeRemaining: valueAsString(getPathValue(value, 'LeaseTimeRemaining')),
    }))
    .filter((host) => host.macAddress || host.ipAddress || host.hostName)
}

function parseAssociatedWifiDevices(device: GenieAcsDevice, path: string, wifiBand: '2.4G' | '5G'): GenieAcsConnectedDevice[] {
  const rawDevices = getPathRaw(device, path)
  if (!rawDevices || typeof rawDevices !== 'object') return []

  return Object.entries(rawDevices as Record<string, unknown>)
    .filter(([index, value]) => /^\d+$/.test(index) && value && typeof value === 'object')
    .map(([index, value]) => {
      const authenticationState = valueAsString(getPathValue(value, 'AssociatedDeviceAuthenticationState'))

      return {
        index: `${wifiBand}-${index}`,
        hostName: valueAsString(getPathValue(value, 'X_ZTE-COM_AssociatedDeviceName')),
        ipAddress: null,
        macAddress: valueAsString(getPathValue(value, 'AssociatedDeviceMACAddress')),
        interfaceType: '802.11',
        addressSource: null,
        active: valueAsBoolean(authenticationState) ?? (authenticationState ? !/^(false|0|down|inactive|inativo)$/i.test(authenticationState) : null),
        leaseTimeRemaining: null,
        wifiBand,
        clientMode: valueAsString(getPathValue(value, 'X_ZTE-COM_WLAN_ClientMode')),
        rssi: valueAsString(getPathValue(value, 'AssociatedDeviceRssi')),
        bandwidth: valueAsString(getPathValue(value, 'AssociatedDeviceBandWidth')),
        rate: valueAsString(getPathValue(value, 'AssociatedDeviceRate')),
        noise: valueAsString(getPathValue(value, 'X_ZTE-COM_WLAN_Noise')),
        uptime: valueAsString(getPathValue(value, 'X_ZTE-COM_StayTime')),
        rxBytes: valueAsString(getPathValue(value, 'X_ZTE-COM_WLAN_BytesReceived')),
        txBytes: valueAsString(getPathValue(value, 'X_ZTE-COM_WLAN_BytesSend')),
        authenticationState,
      }
    })
    .filter((host) => host.macAddress || host.hostName)
}

function mergeConnectedDevices(hosts: GenieAcsConnectedDevice[], wifiDevices: GenieAcsConnectedDevice[]) {
  const merged = new Map<string, GenieAcsConnectedDevice>()

  for (const host of hosts) {
    const key = host.macAddress?.toLowerCase() || `host:${host.index}`
    merged.set(key, host)
  }

  for (const wifiDevice of wifiDevices) {
    const key = wifiDevice.macAddress?.toLowerCase() || `wifi:${wifiDevice.index}`
    const current = merged.get(key)
    merged.set(key, current ? {
      ...current,
      ...wifiDevice,
      hostName: wifiDevice.hostName || current.hostName,
      ipAddress: current.ipAddress || wifiDevice.ipAddress,
      addressSource: current.addressSource || wifiDevice.addressSource,
      leaseTimeRemaining: current.leaseTimeRemaining || wifiDevice.leaseTimeRemaining,
      active: wifiDevice.active ?? current.active,
    } : wifiDevice)
  }

  return [...merged.values()]
}

async function readWifiInfo(settings: GenieAcsSettingsSecret, deviceId: string): Promise<GenieAcsWifiInfo> {
  const projection = [
    settings.wifiSsidParameter,
    settings.wifiPasswordParameter,
    settings.wifi5SsidParameter,
    settings.wifi5PasswordParameter,
    '_lastInform',
  ]
  const device = await getDeviceById(settings, deviceId, projection)

  return {
    band24: {
      ssid: device ? valueAsString(getPathValue(device, settings.wifiSsidParameter)) : null,
      password: device ? valueAsString(getPathValue(device, settings.wifiPasswordParameter)) : null,
    },
    band5: {
      ssid: device ? valueAsString(getPathValue(device, settings.wifi5SsidParameter)) : null,
      password: device ? valueAsString(getPathValue(device, settings.wifi5PasswordParameter)) : null,
    },
  }
}

export async function listGenieAcsConnectedDevices(provisioning: { id: string; serial: string; genieAcsDeviceId?: string | null }) {
  const { settings, deviceId } = await ensureProvisioningDevice(provisioning)
  const hostsTask = await postTask(settings, deviceId, {
    name: 'refreshObject',
    objectName: settings.hostsObjectPath,
  })
  const wifi24ClientsTask = await postTask(settings, deviceId, {
    name: 'refreshObject',
    objectName: settings.wifi24AssociatedDevicePath,
  }).catch((error) => ({ queued: true, task: { error: error instanceof Error ? error.message : String(error) } }))
  const wifi5ClientsTask = await postTask(settings, deviceId, {
    name: 'refreshObject',
    objectName: settings.wifi5AssociatedDevicePath,
  }).catch((error) => ({ queued: true, task: { error: error instanceof Error ? error.message : String(error) } }))
  const wifiTask = await postTask(settings, deviceId, {
    name: 'refreshObject',
    objectName: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
  }).catch((error) => ({ queued: true, task: { error: error instanceof Error ? error.message : String(error) } }))
  const device = await getDeviceById(settings, deviceId, [
    settings.hostsObjectPath,
    settings.wifi24AssociatedDevicePath,
    settings.wifi5AssociatedDevicePath,
    '_lastInform',
  ])
  const hosts = device ? mergeConnectedDevices(parseHosts(device, settings.hostsObjectPath), [
    ...parseAssociatedWifiDevices(device, settings.wifi24AssociatedDevicePath, '2.4G'),
    ...parseAssociatedWifiDevices(device, settings.wifi5AssociatedDevicePath, '5G'),
  ]) : []
  const wifi = await readWifiInfo(settings, deviceId)

  return {
    deviceId,
    queued: hostsTask.queued || wifiTask.queued || wifi24ClientsTask.queued || wifi5ClientsTask.queued,
    task: hostsTask.task,
    hosts,
    wifi,
  }
}

export async function setGenieAcsWifi(provisioning: { id: string; serial: string; genieAcsDeviceId?: string | null }, input: { ssid?: string; password?: string; ssid5?: string; password5?: string }) {
  const { settings, deviceId } = await ensureProvisioningDevice(provisioning)
  const parameterValues: [string, string, string][] = []
  if (typeof input.ssid === 'string' && input.ssid.trim()) {
    const ssidPolicyError = getWifiSsidPolicyError(input.ssid)
    if (ssidPolicyError) throw new Error(ssidPolicyError)
    parameterValues.push([settings.wifiSsidParameter, input.ssid.trim(), 'xsd:string'])
  }
  if (typeof input.password === 'string' && input.password) {
    const passwordPolicyError = getWifiPasswordPolicyError(input.password)
    if (passwordPolicyError) throw new Error(passwordPolicyError)
    parameterValues.push([settings.wifiPasswordParameter, input.password, 'xsd:string'])
  }
  if (typeof input.ssid5 === 'string' && input.ssid5.trim()) {
    const ssidPolicyError = getWifiSsidPolicyError(input.ssid5)
    if (ssidPolicyError) throw new Error(ssidPolicyError)
    parameterValues.push([settings.wifi5SsidParameter, input.ssid5.trim(), 'xsd:string'])
  }
  if (typeof input.password5 === 'string' && input.password5) {
    const passwordPolicyError = getWifiPasswordPolicyError(input.password5)
    if (passwordPolicyError) throw new Error(passwordPolicyError)
    parameterValues.push([settings.wifi5PasswordParameter, input.password5, 'xsd:string'])
  }
  if (!parameterValues.length) {
    throw new Error('Informe nome de Wi-Fi ou senha para alterar.')
  }

  const task = await postTask(settings, deviceId, {
    name: 'setParameterValues',
    parameterValues,
  })

  const currentWifi = await readWifiInfo(settings, deviceId)
  const wifi: GenieAcsWifiInfo = {
    band24: {
      ssid: input.ssid?.trim() || currentWifi.band24.ssid,
      password: input.password || currentWifi.band24.password,
    },
    band5: {
      ssid: input.ssid5?.trim() || currentWifi.band5.ssid,
      password: input.password5 || currentWifi.band5.password,
    },
  }

  return { deviceId, queued: task.queued, task: task.task, changed: parameterValues.map(([name]) => name), wifi }
}

export async function testGenieAcsConnection() {
  const settings = await getSecretSettings()
  if (!settings.enabled && !settings.baseUrl) {
    throw new Error('Informe a URL do GenieACS antes de testar.')
  }

  try {
    await genieAcsFetch(settings, `/devices?${queryString({ query: JSON.stringify({}), projection: '_id,_lastInform' })}`)
    await saveConnectionStatus(true)
    return getGenieAcsSettingsPublic()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await saveConnectionStatus(false, message)
    throw error
  }
}
