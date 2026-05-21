import { prisma } from '@/lib/prisma'
import { decryptAuthSecret, encryptAuthSecret } from '@/lib/auth-security'
import type { ErpLookupKey, ErpProvider, OperatorErpConfigPublic, OperatorErpConfigSecret } from './types'
import { cleanBaseUrl, textValue } from './utils'

type ConfigRow = {
  id: string
  landlordId: string
  provider: string
  baseUrl: string
  enabled: boolean | number
  allowedLookupKeys: string
  tokenEncrypted: string | null
  usernameEncrypted: string | null
  passwordEncrypted: string | null
  clientIdEncrypted: string | null
  clientSecretEncrypted: string | null
  extraJson: string | null
  lastConnectionStatus: string | null
  lastConnectionTestAt: Date | string | null
  lastError: string | null
}

export const erpProviders: ErpProvider[] = ['hubsoft', 'sgp', 'ispfy', 'beesweb', 'mikweb']
export const erpLookupKeys: ErpLookupKey[] = ['cpf_cnpj', 'customer_id', 'contract_id']
export const erpProviderLookupKeys: Record<ErpProvider, ErpLookupKey[]> = {
  hubsoft: erpLookupKeys,
  sgp: erpLookupKeys,
  ispfy: erpLookupKeys,
  beesweb: erpLookupKeys,
  mikweb: ['cpf_cnpj', 'customer_id'],
}
const defaultErpHostAllowlist: Record<ErpProvider, string[]> = {
  hubsoft: ['hubsoft.com.br'],
  sgp: ['sgp.net.br'],
  ispfy: ['ispfy.com.br'],
  beesweb: ['beesweb.com.br'],
  mikweb: ['mikweb.com.br'],
}

export function isErpProvider(value: unknown): value is ErpProvider {
  return erpProviders.includes(value as ErpProvider)
}

export function compatibleLookupKeys(provider: ErpProvider) {
  return erpProviderLookupKeys[provider] ?? erpLookupKeys
}

export function isLookupKeyCompatible(provider: ErpProvider, key: ErpLookupKey) {
  return compatibleLookupKeys(provider).includes(key)
}

export function normalizeLookupKeys(value: unknown, provider: ErpProvider = 'hubsoft'): ErpLookupKey[] {
  const compatibleKeys = compatibleLookupKeys(provider)
  const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : compatibleKeys
  const keys = input.filter((item): item is ErpLookupKey => compatibleKeys.includes(item as ErpLookupKey))
  return keys.length ? [...new Set(keys)] : compatibleKeys
}

function envList(name: string) {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function providerHostAllowlist(provider: ErpProvider) {
  return [
    ...defaultErpHostAllowlist[provider],
    ...envList('ERP_ALLOWED_HOSTS'),
    ...envList(`ERP_ALLOWED_HOSTS_${provider.toUpperCase()}`),
  ]
}

function hostMatchesAllowlist(hostname: string, allowlist: string[]) {
  const host = hostname.toLowerCase()
  return allowlist.some((allowedHost) => {
    const allowed = allowedHost.replace(/^\*\./, '').toLowerCase()
    return host === allowed || host.endsWith(`.${allowed}`)
  })
}

function shouldEnforceHostAllowlist() {
  return process.env.NODE_ENV === 'production' || process.env.ERP_ENFORCE_HOST_ALLOWLIST === 'true'
}

export function sanitizeErpBaseUrl(provider: ErpProvider, value: string) {
  const clean = provider === 'hubsoft'
    ? cleanBaseUrl(value).replace(/\/oauth\/token$/i, '')
    : cleanBaseUrl(value)
  const rawUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean) ? clean : `https://${clean}`
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL base do ERP invalida.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL base do ERP deve usar HTTP ou HTTPS.')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('URL base do ERP deve usar HTTPS em producao.')
  }
  if (url.username || url.password) {
    throw new Error('URL base do ERP nao deve conter usuario ou senha.')
  }
  if (url.search || url.hash) {
    throw new Error('URL base do ERP nao deve conter query string ou fragmento.')
  }

  const allowlist = providerHostAllowlist(provider)
  if (shouldEnforceHostAllowlist() && !hostMatchesAllowlist(url.hostname, allowlist)) {
    throw new Error('Host do ERP nao permitido para o provedor selecionado.')
  }

  return cleanBaseUrl(url.toString())
}

function decryptOptional(value: string | null) {
  if (!value) return null
  try {
    return decryptAuthSecret(value)
  } catch {
    return null
  }
}

function parseLookupKeys(value: string | null, provider: ErpProvider) {
  if (!value) return compatibleLookupKeys(provider)
  try {
    return normalizeLookupKeys(JSON.parse(value), provider)
  } catch {
    return normalizeLookupKeys(value, provider)
  }
}

function publicConfig(row: ConfigRow): OperatorErpConfigPublic {
  const provider = isErpProvider(row.provider) ? row.provider : 'hubsoft'
  return {
    id: row.id,
    provider,
    baseUrl: row.baseUrl,
    enabled: Boolean(row.enabled),
    allowedLookupKeys: parseLookupKeys(row.allowedLookupKeys, provider),
    hasToken: Boolean(row.tokenEncrypted),
    hasUsername: Boolean(row.usernameEncrypted),
    hasPassword: Boolean(row.passwordEncrypted),
    hasClientId: Boolean(row.clientIdEncrypted),
    hasClientSecret: Boolean(row.clientSecretEncrypted),
    lastConnectionStatus: row.lastConnectionStatus,
    lastConnectionTestAt: row.lastConnectionTestAt ? new Date(row.lastConnectionTestAt).toISOString() : null,
    lastError: row.lastError,
  }
}

function secretConfig(row: ConfigRow): OperatorErpConfigSecret {
  const provider = isErpProvider(row.provider) ? row.provider : 'hubsoft'
  return {
    id: row.id,
    landlordId: row.landlordId,
    provider,
    baseUrl: sanitizeErpBaseUrl(provider, row.baseUrl),
    enabled: Boolean(row.enabled),
    allowedLookupKeys: parseLookupKeys(row.allowedLookupKeys, provider),
    token: decryptOptional(row.tokenEncrypted),
    username: decryptOptional(row.usernameEncrypted),
    password: decryptOptional(row.passwordEncrypted),
    clientId: decryptOptional(row.clientIdEncrypted),
    clientSecret: decryptOptional(row.clientSecretEncrypted),
    extra: row.extraJson ? JSON.parse(row.extraJson) as Record<string, unknown> : null,
  }
}

export async function getLandlordForUser(userId: string, nameFallback?: string | null) {
  const existing = await prisma.landlord.findUnique({ where: { userId } })
  if (existing) return existing

  return prisma.landlord.create({
    data: {
      userId,
      name: nameFallback || 'Operador',
    },
  })
}

export async function getErpConfigPublic(landlordId: string) {
  const rows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT * FROM "OperatorErpConfig" WHERE "landlordId" = ${landlordId} LIMIT 1
  `
  return rows[0] ? publicConfig(rows[0]) : null
}

export async function getActiveErpConfigSecret(landlordId: string) {
  const rows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT * FROM "OperatorErpConfig" WHERE "landlordId" = ${landlordId} AND "enabled" = true LIMIT 1
  `
  return rows[0] ? secretConfig(rows[0]) : null
}

export async function getErpConfigSecret(landlordId: string) {
  const rows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT * FROM "OperatorErpConfig" WHERE "landlordId" = ${landlordId} LIMIT 1
  `
  return rows[0] ? secretConfig(rows[0]) : null
}

export async function upsertErpConfig(input: {
  landlordId: string
  provider: ErpProvider
  baseUrl: string
  enabled: boolean
  allowedLookupKeys: ErpLookupKey[]
  token?: string | null
  username?: string | null
  password?: string | null
  clientId?: string | null
  clientSecret?: string | null
}) {
  const existingRows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT * FROM "OperatorErpConfig" WHERE "landlordId" = ${input.landlordId} LIMIT 1
  `
  const existing = existingRows[0] ?? null
  const id = existing?.id ?? (globalThis.crypto?.randomUUID?.() ?? `erp_${Date.now()}`)
  const baseUrl = sanitizeErpBaseUrl(input.provider, input.baseUrl)
  const allowedLookupKeys = JSON.stringify(normalizeLookupKeys(input.allowedLookupKeys, input.provider))
  const sameProvider = existing?.provider === input.provider
  const tokenEncrypted = textValue(input.token) ? encryptAuthSecret(String(input.token).trim()) : sameProvider ? existing?.tokenEncrypted ?? null : null
  const usernameEncrypted = textValue(input.username) ? encryptAuthSecret(String(input.username).trim()) : sameProvider ? existing?.usernameEncrypted ?? null : null
  const passwordEncrypted = textValue(input.password) ? encryptAuthSecret(String(input.password)) : sameProvider ? existing?.passwordEncrypted ?? null : null
  const clientIdEncrypted = textValue(input.clientId) ? encryptAuthSecret(String(input.clientId).trim()) : sameProvider ? existing?.clientIdEncrypted ?? null : null
  const clientSecretEncrypted = textValue(input.clientSecret) ? encryptAuthSecret(String(input.clientSecret)) : sameProvider ? existing?.clientSecretEncrypted ?? null : null

  if (existing) {
    await prisma.$executeRaw`
      UPDATE "OperatorErpConfig"
      SET "provider" = ${input.provider},
          "baseUrl" = ${baseUrl},
          "enabled" = ${input.enabled},
          "allowedLookupKeys" = ${allowedLookupKeys},
          "tokenEncrypted" = ${tokenEncrypted},
          "usernameEncrypted" = ${usernameEncrypted},
          "passwordEncrypted" = ${passwordEncrypted},
          "clientIdEncrypted" = ${clientIdEncrypted},
          "clientSecretEncrypted" = ${clientSecretEncrypted},
          "lastConnectionStatus" = NULL,
          "lastError" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO "OperatorErpConfig" (
        "id", "landlordId", "provider", "baseUrl", "enabled", "allowedLookupKeys",
        "tokenEncrypted", "usernameEncrypted", "passwordEncrypted", "clientIdEncrypted", "clientSecretEncrypted", "updatedAt"
      ) VALUES (
        ${id}, ${input.landlordId}, ${input.provider}, ${baseUrl}, ${input.enabled}, ${allowedLookupKeys},
        ${tokenEncrypted}, ${usernameEncrypted}, ${passwordEncrypted}, ${clientIdEncrypted}, ${clientSecretEncrypted}, CURRENT_TIMESTAMP
      )
    `
  }

  return getErpConfigPublic(input.landlordId)
}

export async function setErpConfigTestStatus(id: string, ok: boolean, error?: string | null) {
  await prisma.$executeRaw`
    UPDATE "OperatorErpConfig"
    SET "lastConnectionStatus" = ${ok ? 'ok' : 'error'},
        "lastConnectionTestAt" = CURRENT_TIMESTAMP,
        "lastError" = ${error ?? null},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
}
