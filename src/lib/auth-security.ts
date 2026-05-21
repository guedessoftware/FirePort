import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

type LoginAttempt = {
  count: number
  firstAttemptAt: number
  lockedUntil: number
}

type LoginRiskInput = {
  email: string
  ip: string
  userAgent: string
}

type RequestLike = {
  headers?: Headers | Record<string, string | string[] | undefined>
}

const PASSWORD_HASH_ROUNDS = 12
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6
const TOTP_WINDOW = 1
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCK_MS = 15 * 60 * 1000
const MAX_ACCOUNT_ATTEMPTS = 8
const MAX_ACCOUNT_IP_ATTEMPTS = 5
const MAX_IP_ATTEMPTS = 40
const MAX_NETWORK_ATTEMPTS = 120
const MAX_FINGERPRINT_ATTEMPTS = 30
const DUMMY_PASSWORD_HASH = '$2b$12$p9P4mLeKm9FCQC/HBFBz8eg1.hzFA9AI/AW8EtAGw2II3CVwZDBH6'

const blockedPasswordWords = [
  '123456',
  '123456789',
  'admin',
  'fireport',
  'password',
  'qwerty',
  'senha',
  'senha123',
]

const globalForAuthSecurity = globalThis as unknown as {
  loginAttempts: Map<string, LoginAttempt> | undefined
}

const loginAttempts = globalForAuthSecurity.loginAttempts ?? new Map<string, LoginAttempt>()
globalForAuthSecurity.loginAttempts = loginAttempts

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function getPasswordPolicyError(password: string, email?: string) {
  const trimmedEmail = email ? normalizeEmail(email) : ''
  const normalizedPassword = password.normalize('NFKC')
  const loweredPassword = normalizedPassword.toLowerCase()
  const emailUser = trimmedEmail.split('@')[0] ?? ''

  if (normalizedPassword.length < 12) {
    return 'Use uma senha com pelo menos 12 caracteres.'
  }

  if (normalizedPassword.length > 128) {
    return 'Use uma senha com no maximo 128 caracteres.'
  }

  if (blockedPasswordWords.some((word) => loweredPassword.includes(word))) {
    return 'Use uma senha menos comum e sem termos previsiveis.'
  }

  if (emailUser.length >= 4 && loweredPassword.includes(emailUser)) {
    return 'A senha nao deve conter parte do email.'
  }

  return null
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password.normalize('NFKC'), PASSWORD_HASH_ROUNDS)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password.normalize('NFKC'), hash)
}

export async function verifyPasswordAgainstDummyHash(password: string) {
  await verifyPassword(password || 'invalid', DUMMY_PASSWORD_HASH)
}

function encryptionKey() {
  const secret = process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'fireport-development-auth-secret')
  if (!secret) {
    throw new Error('Configure NEXTAUTH_SECRET para proteger segredos de autenticacao.')
  }

  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptAuthSecret(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptAuthSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new Error('Formato de segredo MFA invalido.')
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function base32Encode(buffer: Buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31]
  }

  return output
}

function base32Decode(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = value.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let buffer = 0
  const bytes: number[] = []

  for (const char of normalized) {
    const index = alphabet.indexOf(char)
    if (index === -1) {
      throw new Error('Segredo TOTP invalido.')
    }

    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20))
}

export function buildTotpUri(input: { secret: string; accountName: string; issuer?: string }) {
  const issuer = input.issuer || 'FirePort'
  const label = `${issuer}:${input.accountName}`
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

function hotp(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = (
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff)
  ) % 10 ** TOTP_DIGITS

  return String(code).padStart(TOTP_DIGITS, '0')
}

export function verifyTotpCode(secret: string, code: string) {
  const normalizedCode = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalizedCode)) return false

  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS)
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift += 1) {
    const expected = hotp(secret, currentCounter + drift)
    if (crypto.timingSafeEqual(Buffer.from(normalizedCode), Buffer.from(expected))) {
      return true
    }
  }

  return false
}

export function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function hashSecurityToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function readHeader(request: RequestLike | undefined, name: string) {
  const headers = request?.headers
  if (!headers) return ''

  if (headers instanceof Headers) {
    return headers.get(name) ?? ''
  }

  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function normalizeIp(value: string) {
  const firstValue = value.split(',')[0]?.trim() ?? ''
  return firstValue || 'unknown'
}

function networkKey(ip: string) {
  if (ip.includes('.')) {
    const parts = ip.split('.')
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : ip
  }

  if (ip.includes(':')) {
    return `${ip.split(':').slice(0, 4).join(':')}::/64`
  }

  return ip
}

export function getLoginRiskInput(request: RequestLike | undefined, email: string): LoginRiskInput {
  const forwardedIp = readHeader(request, 'x-forwarded-for')
  const ip = normalizeIp(forwardedIp || readHeader(request, 'x-real-ip') || readHeader(request, 'cf-connecting-ip'))
  const userAgent = readHeader(request, 'user-agent').slice(0, 180) || 'unknown'

  return {
    email: normalizeEmail(email),
    ip,
    userAgent,
  }
}

function loginKeys(input: LoginRiskInput) {
  const fingerprint = `${input.ip}:${input.userAgent}`

  return [
    { key: `account:${input.email}`, maxAttempts: MAX_ACCOUNT_ATTEMPTS },
    { key: `account-ip:${input.email}:${input.ip}`, maxAttempts: MAX_ACCOUNT_IP_ATTEMPTS },
    { key: `ip:${input.ip}`, maxAttempts: MAX_IP_ATTEMPTS },
    { key: `network:${networkKey(input.ip)}`, maxAttempts: MAX_NETWORK_ATTEMPTS },
    { key: `fingerprint:${fingerprint}`, maxAttempts: MAX_FINGERPRINT_ATTEMPTS },
  ]
}

function currentAttempt(key: string) {
  const attempt = loginAttempts.get(key)
  if (!attempt) return null

  const now = Date.now()
  if (attempt.lockedUntil > now || now - attempt.firstAttemptAt <= LOGIN_WINDOW_MS) {
    return attempt
  }

  loginAttempts.delete(key)
  return null
}

export function isLoginRateLimited(input: LoginRiskInput) {
  return loginKeys(input).some(({ key }) => {
    const attempt = currentAttempt(key)
    return Boolean(attempt && attempt.lockedUntil > Date.now())
  })
}

export async function delayAfterFailedLogin(input: LoginRiskInput) {
  const highestCount = loginKeys(input).reduce((highest, { key }) => {
    const attempt = currentAttempt(key)
    return Math.max(highest, attempt?.count ?? 0)
  }, 0)
  const delayMs = Math.min(2_000, highestCount * 250)

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

export function registerFailedLogin(input: LoginRiskInput) {
  const now = Date.now()

  for (const { key, maxAttempts } of loginKeys(input)) {
    const current = currentAttempt(key)
    const attempt = current ?? { count: 0, firstAttemptAt: now, lockedUntil: 0 }
    attempt.count += 1
    if (attempt.count >= maxAttempts) {
      attempt.lockedUntil = now + LOGIN_LOCK_MS
    }
    loginAttempts.set(key, attempt)
  }
}

export function clearFailedLogins(input: LoginRiskInput) {
  for (const { key } of loginKeys(input)) {
    loginAttempts.delete(key)
  }
}
