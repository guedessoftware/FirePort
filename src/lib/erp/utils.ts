import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { NormalizedErpAddress } from './types'

type RequestJsonInit = RequestInit & {
  timeoutMs?: number
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function textValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text || null
}

export function numberValue(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function firstText(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = textValue(record[key])
    if (value) return value
  }
  return null
}

export function firstNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null
  for (const key of keys) {
    const value = numberValue(record[key])
    if (value !== null) return value
  }
  return null
}

export function onlyDigits(value: string | null) {
  return value?.replace(/\D/g, '') || null
}

export function cleanBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function joinUrl(baseUrl: string, path: string) {
  const cleanBase = cleanBaseUrl(baseUrl)
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}

function isBlockedIpv4(address: string) {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [first, second] = parts
  return first === 0
    || first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168
    || first === 192 && second === 0
    || first === 198 && (second === 18 || second === 19)
    || first === 100 && second >= 64 && second <= 127
    || first >= 224
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  const mappedIpv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4[1])
  }

  return lower === '::'
    || lower === '::1'
    || lower.startsWith('fc')
    || lower.startsWith('fd')
    || lower.startsWith('fe8')
    || lower.startsWith('fe9')
    || lower.startsWith('fea')
    || lower.startsWith('feb')
    || lower.startsWith('ff')
}

function isBlockedIpAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return isBlockedIpv4(address)
  if (family === 6) return isBlockedIpv6(address)
  return true
}

async function assertSafeErpRequestUrl(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL do ERP invalida.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL do ERP deve usar HTTP ou HTTPS.')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('URL do ERP deve usar HTTPS em producao.')
  }
  if (url.username || url.password) {
    throw new Error('URL do ERP nao deve conter usuario ou senha.')
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('URL do ERP aponta para host local bloqueado.')
  }
  if (isIP(hostname) && isBlockedIpAddress(hostname)) {
    throw new Error('URL do ERP aponta para IP interno ou reservado bloqueado.')
  }

  const addresses = await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some((item) => isBlockedIpAddress(item.address))) {
    throw new Error('URL do ERP resolve para IP interno ou reservado bloqueado.')
  }
}

export function compactAddress(input: Partial<NormalizedErpAddress>): NormalizedErpAddress {
  const street = input.street ?? null
  const neighborhood = input.neighborhood ?? null
  const city = input.city ?? null
  const state = input.state ?? null
  const generatedAddress = [street, neighborhood, [city, state].filter(Boolean).join('/')].filter(Boolean).join(', ')
  const fullAddress = input.fullAddress ?? (generatedAddress || null)

  return {
    cep: onlyDigits(input.cep ?? null),
    street,
    number: input.number ?? null,
    neighborhood,
    city,
    state,
    complement: input.complement ?? null,
    reference: input.reference ?? null,
    fullAddress,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  }
}

export async function requestJson(url: string, init?: RequestJsonInit) {
  await assertSafeErpRequestUrl(url)

  const { timeoutMs = 12_000, ...fetchInit } = init ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs))
  const abortFromCaller = () => controller.abort()

  if (fetchInit.signal?.aborted) {
    controller.abort()
  } else {
    fetchInit.signal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(fetchInit.body ? { 'Content-Type': 'application/json' } : {}),
        ...fetchInit.headers,
      },
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Tempo limite ao consultar o ERP.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    fetchInit.signal?.removeEventListener('abort', abortFromCaller)
  }

  const text = await response.text()
  const body = text ? JSON.parse(text) as unknown : null
  if (!response.ok) {
    const record = asRecord(body)
    const message = firstText(record, ['message', 'error', 'detail']) ?? `ERP retornou HTTP ${response.status}.`
    throw new Error(message)
  }
  return body
}
