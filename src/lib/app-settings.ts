import { ensureSqlitePragmas, prisma } from './prisma'

export type OnuMonitoringSettings = {
  enabled: boolean
  intervalMinutes: number
  lastRunAt: string | null
  lastFinishedAt: string | null
  lastActiveChecked: number
  lastSuccess: number
  lastFailed: number
  lastError: string | null
}

export type OltMonitoringSettings = {
  enabled: boolean
  intervalMinutes: number
  trafficIntervalSeconds: number
  lastRunAt: string | null
  lastFinishedAt: string | null
  lastActiveChecked: number
  lastSuccess: number
  lastFailed: number
  lastError: string | null
}

export type ApplicationSettings = {
  applicationName: string
  companyName: string
  companyLegalName: string
  companyLogo: string | null
  companyLogoDark: string | null
  useCompanyLogo: boolean
  companyDocument: string
  supportEmail: string
  supportPhone: string
  websiteUrl: string
  address: string
  addressPostalCode: string
  city: string
  state: string
  description: string
  viabilityRadiusMeters: number
}

const ONU_MONITORING_KEY = 'onuTelemetryMonitoring'
const OLT_MONITORING_KEY = 'oltTelemetryMonitoring'
const APPLICATION_SETTINGS_KEY = 'applicationSettings'
const DEFAULT_VIABILITY_RADIUS_METERS = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_CTO_RADIUS_METERS || 150)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 5000) : 150
})()
const DEFAULT_ONU_MONITORING_SETTINGS: OnuMonitoringSettings = {
  enabled: false,
  intervalMinutes: 5,
  lastRunAt: null,
  lastFinishedAt: null,
  lastActiveChecked: 0,
  lastSuccess: 0,
  lastFailed: 0,
  lastError: null,
}
const DEFAULT_OLT_MONITORING_SETTINGS: OltMonitoringSettings = {
  enabled: true,
  intervalMinutes: 5,
  trafficIntervalSeconds: 5,
  lastRunAt: null,
  lastFinishedAt: null,
  lastActiveChecked: 0,
  lastSuccess: 0,
  lastFailed: 0,
  lastError: null,
}
const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  applicationName: 'FirePort',
  companyName: 'Empresa',
  companyLegalName: '',
  companyLogo: null,
  companyLogoDark: null,
  useCompanyLogo: false,
  companyDocument: '',
  supportEmail: '',
  supportPhone: '',
  websiteUrl: '',
  address: '',
  addressPostalCode: '',
  city: '',
  state: '',
  description: 'Area do cliente',
  viabilityRadiusMeters: DEFAULT_VIABILITY_RADIUS_METERS,
}

const SQLITE_LOCK_RETRY_DELAYS_MS = [50, 150, 300, 600, 1000, 1500]

export function normalizeOnuMonitoringInterval(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return undefined
  }

  return Math.min(Math.max(parsed, 1), 1440)
}

export function normalizeOltMonitoringInterval(value: unknown) {
  return normalizeOnuMonitoringInterval(value)
}

export function normalizeOltTrafficInterval(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return undefined
  }

  return Math.min(Math.max(parsed, 1), 60)
}

export function normalizeViabilityRadiusMeters(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return undefined
  }

  return Math.min(Math.max(parsed, 1), 5000)
}

function parseSettingsValue<T extends object>(value?: string | null): Partial<T> {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function isSqliteDatabaseLocked(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybeError = error as { code?: string; meta?: { code?: string; message?: string }; message?: string }
  return maybeError.code === 'P2010'
    && maybeError.meta?.code === '5'
    && /database is locked/i.test(maybeError.meta.message ?? maybeError.message ?? '')
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function withSqliteLockRetry<T>(operation: () => Promise<T>): Promise<T> {
  await ensureSqlitePragmas()

  for (let attempt = 0; attempt <= SQLITE_LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isSqliteDatabaseLocked(error) || attempt === SQLITE_LOCK_RETRY_DELAYS_MS.length) {
        throw error
      }

      await wait(SQLITE_LOCK_RETRY_DELAYS_MS[attempt])
    }
  }

  throw new Error('Falha ao acessar configuracao.')
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== 'string') {
    return fallback
  }

  return value.trim().slice(0, maxLength)
}

function normalizeOptionalUrl(value: unknown) {
  const url = normalizeText(value, '', 200)
  if (!url) return ''

  if (/^https?:\/\//i.test(url)) {
    return url
  }

  return `https://${url}`
}

function isValidEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeLogo(value: unknown, fallback: string | null) {
  if (value === undefined) return fallback
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  if (value.length > 1_000_000) return undefined
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return undefined
  return value
}

async function readSetting(key: string) {
  const rows = await withSqliteLockRetry(() => prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value" FROM "AppSetting" WHERE "key" = ${key} LIMIT 1
    `)

  return rows[0]?.value ?? null
}

async function writeSetting(key: string, value: string) {
  await withSqliteLockRetry(() => prisma.$executeRaw`
      INSERT INTO "AppSetting" (
        "id",
        "key",
        "value",
        "createdAt",
        "updatedAt"
      ) VALUES (
        lower(hex(randomblob(16))),
        ${key},
        ${value},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT("key") DO UPDATE SET
        "value" = excluded."value",
        "updatedAt" = CURRENT_TIMESTAMP
    `)
}

export async function getOnuMonitoringSettings(): Promise<OnuMonitoringSettings> {
  const stored = parseSettingsValue<OnuMonitoringSettings>(await readSetting(ONU_MONITORING_KEY))
  const intervalMinutes = normalizeOnuMonitoringInterval(stored.intervalMinutes)

  return {
    ...DEFAULT_ONU_MONITORING_SETTINGS,
    ...stored,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_ONU_MONITORING_SETTINGS.enabled,
    intervalMinutes: intervalMinutes ?? DEFAULT_ONU_MONITORING_SETTINGS.intervalMinutes,
    lastRunAt: typeof stored.lastRunAt === 'string' ? stored.lastRunAt : null,
    lastFinishedAt: typeof stored.lastFinishedAt === 'string' ? stored.lastFinishedAt : null,
    lastActiveChecked: Number(stored.lastActiveChecked) || 0,
    lastSuccess: Number(stored.lastSuccess) || 0,
    lastFailed: Number(stored.lastFailed) || 0,
    lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
  }
}

export async function getOltMonitoringSettings(): Promise<OltMonitoringSettings> {
  const stored = parseSettingsValue<OltMonitoringSettings>(await readSetting(OLT_MONITORING_KEY))
  const intervalMinutes = normalizeOltMonitoringInterval(stored.intervalMinutes)
  const trafficIntervalSeconds = normalizeOltTrafficInterval(stored.trafficIntervalSeconds)

  return {
    ...DEFAULT_OLT_MONITORING_SETTINGS,
    ...stored,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_OLT_MONITORING_SETTINGS.enabled,
    intervalMinutes: intervalMinutes ?? DEFAULT_OLT_MONITORING_SETTINGS.intervalMinutes,
    trafficIntervalSeconds: trafficIntervalSeconds ?? DEFAULT_OLT_MONITORING_SETTINGS.trafficIntervalSeconds,
    lastRunAt: typeof stored.lastRunAt === 'string' ? stored.lastRunAt : null,
    lastFinishedAt: typeof stored.lastFinishedAt === 'string' ? stored.lastFinishedAt : null,
    lastActiveChecked: Number(stored.lastActiveChecked) || 0,
    lastSuccess: Number(stored.lastSuccess) || 0,
    lastFailed: Number(stored.lastFailed) || 0,
    lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
  }
}

export async function getApplicationSettings(): Promise<ApplicationSettings> {
  const stored = parseSettingsValue<ApplicationSettings>(await readSetting(APPLICATION_SETTINGS_KEY))
  const companyLogo = normalizeLogo(stored.companyLogo, DEFAULT_APPLICATION_SETTINGS.companyLogo)
  const companyLogoDark = normalizeLogo(stored.companyLogoDark, DEFAULT_APPLICATION_SETTINGS.companyLogoDark)

  return {
    applicationName: normalizeText(stored.applicationName, DEFAULT_APPLICATION_SETTINGS.applicationName, 80) || DEFAULT_APPLICATION_SETTINGS.applicationName,
    companyName: normalizeText(stored.companyName, DEFAULT_APPLICATION_SETTINGS.companyName, 100) || DEFAULT_APPLICATION_SETTINGS.companyName,
    companyLegalName: normalizeText(stored.companyLegalName, DEFAULT_APPLICATION_SETTINGS.companyLegalName, 140),
    companyLogo: companyLogo === undefined ? DEFAULT_APPLICATION_SETTINGS.companyLogo : companyLogo,
    companyLogoDark: companyLogoDark === undefined ? DEFAULT_APPLICATION_SETTINGS.companyLogoDark : companyLogoDark,
    useCompanyLogo: typeof stored.useCompanyLogo === 'boolean' ? stored.useCompanyLogo : DEFAULT_APPLICATION_SETTINGS.useCompanyLogo,
    companyDocument: normalizeText(stored.companyDocument, DEFAULT_APPLICATION_SETTINGS.companyDocument, 40),
    supportEmail: normalizeText(stored.supportEmail, DEFAULT_APPLICATION_SETTINGS.supportEmail, 120),
    supportPhone: normalizeText(stored.supportPhone, DEFAULT_APPLICATION_SETTINGS.supportPhone, 40),
    websiteUrl: normalizeOptionalUrl(stored.websiteUrl),
    address: normalizeText(stored.address, DEFAULT_APPLICATION_SETTINGS.address, 180),
    addressPostalCode: normalizeText(stored.addressPostalCode, DEFAULT_APPLICATION_SETTINGS.addressPostalCode, 20),
    city: normalizeText(stored.city, DEFAULT_APPLICATION_SETTINGS.city, 80),
    state: normalizeText(stored.state, DEFAULT_APPLICATION_SETTINGS.state, 2).toUpperCase(),
    description: normalizeText(stored.description, DEFAULT_APPLICATION_SETTINGS.description, 180),
    viabilityRadiusMeters: normalizeViabilityRadiusMeters(stored.viabilityRadiusMeters) ?? DEFAULT_APPLICATION_SETTINGS.viabilityRadiusMeters,
  }
}

export async function saveApplicationSettings(input: Partial<ApplicationSettings>) {
  const current = await getApplicationSettings()
  const companyLogo = normalizeLogo(input.companyLogo, current.companyLogo)
  const companyLogoDark = normalizeLogo(input.companyLogoDark, current.companyLogoDark)

  if (companyLogo === undefined || companyLogoDark === undefined) {
    throw new Error('Logo invalido. Envie PNG, JPG ou WebP com ate 1 MB.')
  }

  const next: ApplicationSettings = {
    applicationName: normalizeText(input.applicationName, current.applicationName, 80) || DEFAULT_APPLICATION_SETTINGS.applicationName,
    companyName: normalizeText(input.companyName, current.companyName, 100) || DEFAULT_APPLICATION_SETTINGS.companyName,
    companyLegalName: normalizeText(input.companyLegalName, current.companyLegalName, 140),
    companyLogo,
    companyLogoDark,
    useCompanyLogo: typeof input.useCompanyLogo === 'boolean' ? input.useCompanyLogo : current.useCompanyLogo,
    companyDocument: normalizeText(input.companyDocument, current.companyDocument, 40),
    supportEmail: normalizeText(input.supportEmail, current.supportEmail, 120).toLowerCase(),
    supportPhone: normalizeText(input.supportPhone, current.supportPhone, 40),
    websiteUrl: normalizeOptionalUrl(input.websiteUrl ?? current.websiteUrl),
    address: normalizeText(input.address, current.address, 180),
    addressPostalCode: normalizeText(input.addressPostalCode, current.addressPostalCode, 20),
    city: normalizeText(input.city, current.city, 80),
    state: normalizeText(input.state, current.state, 2).toUpperCase(),
    description: normalizeText(input.description, current.description, 180),
    viabilityRadiusMeters: normalizeViabilityRadiusMeters(input.viabilityRadiusMeters) ?? current.viabilityRadiusMeters,
  }

  if (!isValidEmail(next.supportEmail)) {
    throw new Error('Email de suporte invalido.')
  }

  await writeSetting(APPLICATION_SETTINGS_KEY, JSON.stringify(next))
  return next
}

export async function saveOnuMonitoringSettings(input: { enabled?: boolean; intervalMinutes?: number }) {
  const current = await getOnuMonitoringSettings()
  const intervalMinutes = input.intervalMinutes === undefined
    ? current.intervalMinutes
    : normalizeOnuMonitoringInterval(input.intervalMinutes)

  if (!intervalMinutes) {
    throw new Error('Intervalo deve ser um número inteiro entre 1 e 1440 minutos.')
  }

  const next: OnuMonitoringSettings = {
    ...current,
    enabled: input.enabled ?? current.enabled,
    intervalMinutes,
  }

  await writeSetting(ONU_MONITORING_KEY, JSON.stringify(next))
  return next
}

export async function saveOltMonitoringSettings(input: { enabled?: boolean; intervalMinutes?: number; trafficIntervalSeconds?: number }) {
  const current = await getOltMonitoringSettings()
  const intervalMinutes = input.intervalMinutes === undefined
    ? current.intervalMinutes
    : normalizeOltMonitoringInterval(input.intervalMinutes)
  const trafficIntervalSeconds = input.trafficIntervalSeconds === undefined
    ? current.trafficIntervalSeconds
    : normalizeOltTrafficInterval(input.trafficIntervalSeconds)

  if (!intervalMinutes) {
    throw new Error('Intervalo deve ser um número inteiro entre 1 e 1440 minutos.')
  }

  if (!trafficIntervalSeconds) {
    throw new Error('Intervalo de tráfego deve ser um número inteiro entre 1 e 60 segundos.')
  }

  const next: OltMonitoringSettings = {
    ...current,
    enabled: input.enabled ?? current.enabled,
    intervalMinutes,
    trafficIntervalSeconds,
  }

  await writeSetting(OLT_MONITORING_KEY, JSON.stringify(next))
  return next
}

export async function saveOnuMonitoringRunResult(input: {
  startedAt: Date
  finishedAt: Date
  activeChecked: number
  success: number
  failed: number
  error?: string | null
}) {
  const current = await getOnuMonitoringSettings()
  const next: OnuMonitoringSettings = {
    ...current,
    lastRunAt: input.startedAt.toISOString(),
    lastFinishedAt: input.finishedAt.toISOString(),
    lastActiveChecked: input.activeChecked,
    lastSuccess: input.success,
    lastFailed: input.failed,
    lastError: input.error ?? null,
  }

  await writeSetting(ONU_MONITORING_KEY, JSON.stringify(next))
  return next
}

export async function saveOltMonitoringRunResult(input: {
  startedAt: Date
  finishedAt: Date
  activeChecked: number
  success: number
  failed: number
  error?: string | null
}) {
  const current = await getOltMonitoringSettings()
  const next: OltMonitoringSettings = {
    ...current,
    lastRunAt: input.startedAt.toISOString(),
    lastFinishedAt: input.finishedAt.toISOString(),
    lastActiveChecked: input.activeChecked,
    lastSuccess: input.success,
    lastFailed: input.failed,
    lastError: input.error ?? null,
  }

  await writeSetting(OLT_MONITORING_KEY, JSON.stringify(next))
  return next
}
