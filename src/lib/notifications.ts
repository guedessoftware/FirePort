import net from 'node:net'
import tls from 'node:tls'
import { prisma } from './prisma'

const NOTIFICATION_SETTINGS_KEY = 'notificationSettings'

export type NotificationTemplateStage =
  | 'late_warning'
  | 'suspension_warning'
  | 'financial_partial_block'
  | 'financial_total_block'

export type NotificationTemplate = {
  emailSubject: string
  message: string
}

export type NotificationSettings = {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPassword: string
  smtpPasswordSet: boolean
  smtpFromEmail: string
  smtpFromName: string
  whatsappEnabled: boolean
  whatsappGatewayUrl: string
  whatsappMethod: 'POST' | 'GET'
  whatsappToken: string
  whatsappTokenSet: boolean
  whatsappTokenHeader: string
  whatsappBodyTemplate: string
  maxAttempts: number
  templates: Record<NotificationTemplateStage, NotificationTemplate>
}

type StoredNotificationSettings = Omit<NotificationSettings, 'smtpPasswordSet' | 'whatsappTokenSet'>

type QueueRow = {
  id: string
  billingAccountId: string
  stage: NotificationTemplateStage | string
  channels: string
  message: string
  status: string
  attempts: number
  details: string | null
  userName: string | null
  userEmail: string | null
  landlordName: string | null
  hubsoftPrimaryEmail: string | null
  hubsoftPrimaryPhone: string | null
  hubsoftSecondaryPhone: string | null
}

type TemplateContext = {
  cliente: string
  email: string
  telefone: string
  dias_atraso: string
  empresa: string
  portal_url: string
}

const DEFAULT_TEMPLATES: Record<NotificationTemplateStage, NotificationTemplate> = {
  late_warning: {
    emailSubject: '{{empresa}} - aviso de atraso',
    message: 'Olá {{cliente}}, identificamos {{dias_atraso}} dia(s) de atraso. Regularize suas faturas no portal {{portal_url}} para evitar bloqueios.',
  },
  suspension_warning: {
    emailSubject: '{{empresa}} - aviso de suspensão',
    message: 'Olá {{cliente}}, sua conta está com {{dias_atraso}} dia(s) de atraso e poderá ser suspensa. Acesse {{portal_url}} para regularizar.',
  },
  financial_partial_block: {
    emailSubject: '{{empresa}} - bloqueio parcial aplicado',
    message: 'Olá {{cliente}}, sua conta está com {{dias_atraso}} dia(s) de atraso. Novas alterações e provisionamentos estão bloqueados até a regularização.',
  },
  financial_total_block: {
    emailSubject: '{{empresa}} - suspensão total aplicada',
    message: 'Olá {{cliente}}, sua conta está com {{dias_atraso}} dia(s) de atraso e o acesso foi suspenso. Faturas e suporte continuam disponíveis em {{portal_url}}.',
  },
}

const DEFAULT_WHATSAPP_BODY_TEMPLATE = JSON.stringify({
  phone: '{{telefone}}',
  message: '{{mensagem}}',
}, null, 2)

const DEFAULT_NOTIFICATION_SETTINGS: StoredNotificationSettings = {
  emailEnabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  smtpFromEmail: '',
  smtpFromName: 'Fireport',
  whatsappEnabled: false,
  whatsappGatewayUrl: '',
  whatsappMethod: 'POST',
  whatsappToken: '',
  whatsappTokenHeader: 'Authorization',
  whatsappBodyTemplate: DEFAULT_WHATSAPP_BODY_TEMPLATE,
  maxAttempts: 3,
  templates: DEFAULT_TEMPLATES,
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, maxLength)
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function normalizePort(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback
  return parsed
}

function normalizeAttempts(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return fallback
  return parsed
}

function normalizeUrl(value: unknown, fallback: string) {
  const text = normalizeText(value, fallback, 500)
  if (!text) return ''
  return /^https?:\/\//i.test(text) ? text : `https://${text}`
}

function parseStoredSettings(value?: string | null): Partial<StoredNotificationSettings> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function publicSettings(settings: StoredNotificationSettings): NotificationSettings {
  return {
    ...settings,
    smtpPasswordSet: Boolean(settings.smtpPassword),
    smtpPassword: '',
    whatsappTokenSet: Boolean(settings.whatsappToken),
    whatsappToken: '',
  }
}

function sanitizeStored(input: Partial<NotificationSettings>, current: StoredNotificationSettings): StoredNotificationSettings {
  const templates = { ...current.templates }
  const inputTemplates: Partial<Record<NotificationTemplateStage, Partial<NotificationTemplate>>> =
    input.templates && typeof input.templates === 'object' ? input.templates : {}
  for (const stage of Object.keys(DEFAULT_TEMPLATES) as NotificationTemplateStage[]) {
    templates[stage] = {
      emailSubject: normalizeText(inputTemplates[stage]?.emailSubject, templates[stage].emailSubject, 160),
      message: normalizeText(inputTemplates[stage]?.message, templates[stage].message, 1200),
    }
  }

  const whatsappMethod = input.whatsappMethod === 'GET' ? 'GET' : input.whatsappMethod === 'POST' ? 'POST' : current.whatsappMethod

  return {
    emailEnabled: normalizeBoolean(input.emailEnabled, current.emailEnabled),
    smtpHost: normalizeText(input.smtpHost, current.smtpHost, 180),
    smtpPort: normalizePort(input.smtpPort, current.smtpPort),
    smtpSecure: normalizeBoolean(input.smtpSecure, current.smtpSecure),
    smtpUser: normalizeText(input.smtpUser, current.smtpUser, 180),
    smtpPassword: typeof input.smtpPassword === 'string' && input.smtpPassword
      ? input.smtpPassword.slice(0, 500)
      : current.smtpPassword,
    smtpFromEmail: normalizeText(input.smtpFromEmail, current.smtpFromEmail, 180).toLowerCase(),
    smtpFromName: normalizeText(input.smtpFromName, current.smtpFromName, 120) || DEFAULT_NOTIFICATION_SETTINGS.smtpFromName,
    whatsappEnabled: normalizeBoolean(input.whatsappEnabled, current.whatsappEnabled),
    whatsappGatewayUrl: normalizeUrl(input.whatsappGatewayUrl, current.whatsappGatewayUrl),
    whatsappMethod,
    whatsappToken: typeof input.whatsappToken === 'string' && input.whatsappToken
      ? input.whatsappToken.slice(0, 1000)
      : current.whatsappToken,
    whatsappTokenHeader: normalizeText(input.whatsappTokenHeader, current.whatsappTokenHeader, 80) || 'Authorization',
    whatsappBodyTemplate: normalizeText(input.whatsappBodyTemplate, current.whatsappBodyTemplate, 3000) || DEFAULT_WHATSAPP_BODY_TEMPLATE,
    maxAttempts: normalizeAttempts(input.maxAttempts, current.maxAttempts),
    templates,
  }
}

async function readSetting() {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${NOTIFICATION_SETTINGS_KEY} LIMIT 1
  `

  return rows[0]?.value ?? null
}

async function writeSetting(settings: StoredNotificationSettings) {
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("id", "key", "value", "createdAt", "updatedAt")
    VALUES (lower(hex(randomblob(16))), ${NOTIFICATION_SETTINGS_KEY}, ${JSON.stringify(settings)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT("key") DO UPDATE SET
      "value" = excluded."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `
}

async function storedNotificationSettings(): Promise<StoredNotificationSettings> {
  const stored = parseStoredSettings(await readSetting())
  return sanitizeStored(stored as Partial<NotificationSettings>, DEFAULT_NOTIFICATION_SETTINGS)
}

export async function getNotificationSettings() {
  return publicSettings(await storedNotificationSettings())
}

export async function saveNotificationSettings(input: Partial<NotificationSettings>) {
  const current = await storedNotificationSettings()
  const next = sanitizeStored(input, current)
  await writeSetting(next)
  return publicSettings(next)
}

async function ensureNotificationDeliverySchema() {
  const columns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("AccessControlNotification")`
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('attempts')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "AccessControlNotification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0')
  }
  if (!names.has('lastAttemptAt')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "AccessControlNotification" ADD COLUMN "lastAttemptAt" DATETIME')
  }
  if (!names.has('lastError')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "AccessControlNotification" ADD COLUMN "lastError" TEXT')
  }
}

function parseDetails(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function normalizePhone(value: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('55') ? digits : `55${digits}`
}

function renderTemplate(template: string, context: TemplateContext & { mensagem?: string }) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = context[key as keyof typeof context]
    return value === undefined || value === null ? '' : String(value)
  })
}

function smtpEscape(value: string) {
  return value.replace(/[\r\n]/g, ' ').trim()
}

function buildEmailMessage(input: {
  fromEmail: string
  fromName: string
  to: string
  subject: string
  body: string
}) {
  const from = input.fromName
    ? `"${smtpEscape(input.fromName).replace(/"/g, '\\"')}" <${smtpEscape(input.fromEmail)}>`
    : smtpEscape(input.fromEmail)
  const headers = [
    `From: ${from}`,
    `To: ${smtpEscape(input.to)}`,
    `Subject: ${smtpEscape(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ]
  const body = input.body.replace(/^\./gm, '..')
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n.`
}

async function smtpRead(socket: net.Socket | tls.TLSSocket) {
  return new Promise<string>((resolve, reject) => {
    let buffer = ''
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1]
      if (/^\d{3}\s/.test(last ?? '')) {
        cleanup()
        resolve(buffer)
      }
    }
    socket.on('data', onData)
    socket.on('error', onError)
  })
}

async function smtpWrite(socket: net.Socket | tls.TLSSocket, command: string, expected?: number[]) {
  socket.write(`${command}\r\n`)
  const response = await smtpRead(socket)
  const code = Number(response.slice(0, 3))
  if (expected?.length && !expected.includes(code)) {
    throw new Error(`SMTP respondeu ${code}: ${response.trim()}`)
  }
  return response
}

async function smtpAuthenticate(socket: net.Socket | tls.TLSSocket, username: string, password: string) {
  const plainCredentials = Buffer.from(`\0${username}\0${password}`).toString('base64')

  try {
    await smtpWrite(socket, `AUTH PLAIN ${plainCredentials}`, [235])
    return
  } catch (plainError) {
    try {
      await smtpWrite(socket, 'AUTH LOGIN', [334])
      await smtpWrite(socket, Buffer.from(username).toString('base64'), [334])
      await smtpWrite(socket, Buffer.from(password).toString('base64'), [235])
      return
    } catch (loginError) {
      const plainMessage = plainError instanceof Error ? plainError.message : String(plainError)
      const loginMessage = loginError instanceof Error ? loginError.message : String(loginError)
      throw new Error(`Falha de autenticacao SMTP. AUTH PLAIN: ${plainMessage}. AUTH LOGIN: ${loginMessage}`)
    }
  }
}

async function smtpConnect(settings: StoredNotificationSettings) {
  const socket = settings.smtpSecure
    ? tls.connect({ host: settings.smtpHost, port: settings.smtpPort, servername: settings.smtpHost })
    : net.connect({ host: settings.smtpHost, port: settings.smtpPort })

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  await smtpRead(socket)

  if (!settings.smtpSecure) {
    await smtpWrite(socket, `EHLO ${settings.smtpHost}`, [250])
    await smtpWrite(socket, 'STARTTLS', [220])
    const secureSocket = tls.connect({ socket, servername: settings.smtpHost })
    await new Promise<void>((resolve, reject) => {
      secureSocket.once('secureConnect', resolve)
      secureSocket.once('error', reject)
    })
    await smtpWrite(secureSocket, `EHLO ${settings.smtpHost}`, [250])
    return secureSocket
  }

  await smtpWrite(socket, `EHLO ${settings.smtpHost}`, [250])
  return socket
}

async function sendEmail(settings: StoredNotificationSettings, to: string, subject: string, body: string) {
  if (!settings.smtpHost || !settings.smtpFromEmail || !to) {
    throw new Error('SMTP sem host/remetente ou destinatario.')
  }
  const socket = await smtpConnect(settings)
  try {
    if (settings.smtpUser && settings.smtpPassword) {
      await smtpAuthenticate(socket, settings.smtpUser, settings.smtpPassword)
    }
    await smtpWrite(socket, `MAIL FROM:<${settings.smtpFromEmail}>`, [250])
    await smtpWrite(socket, `RCPT TO:<${to}>`, [250, 251])
    await smtpWrite(socket, 'DATA', [354])
    await smtpWrite(socket, buildEmailMessage({
      fromEmail: settings.smtpFromEmail,
      fromName: settings.smtpFromName,
      to,
      subject,
      body,
    }), [250])
    await smtpWrite(socket, 'QUIT')
  } finally {
    socket.end()
  }
}

export async function sendPasswordResetEmail(input: { to: string; name?: string | null; resetUrl: string }) {
  const settings = await storedNotificationSettings()
  if (!settings.emailEnabled) {
    throw new Error('Envio por email esta desativado. Configure e ative o SMTP em Admin > Configuracoes > Notificacoes.')
  }

  const name = input.name || input.to
  const company = settings.smtpFromName || 'FirePort'
  await sendEmail(
    settings,
    input.to,
    `${company} - redefinicao de senha`,
    [
      `Ola ${name},`,
      '',
      'Recebemos uma solicitacao para redefinir sua senha.',
      'Use o link abaixo em ate 30 minutos:',
      '',
      input.resetUrl,
      '',
      'Se voce nao solicitou esta redefinicao, ignore este email.',
    ].join('\n'),
  )
}

export async function sendContractAcceptanceOtpEmail(input: {
  to: string
  name?: string | null
  code: string
  contractTitle: string
  expiresMinutes: number
}) {
  const settings = await storedNotificationSettings()
  if (!settings.emailEnabled) {
    throw new Error('Envio por email esta desativado.')
  }

  const name = input.name || input.to
  const company = settings.smtpFromName || 'FirePort'
  await sendEmail(
    settings,
    input.to,
    `${company} - codigo de aceite contratual`,
    [
      `Ola ${name},`,
      '',
      `Recebemos uma solicitacao para aceite do contrato "${input.contractTitle}".`,
      `Use o codigo abaixo em ate ${input.expiresMinutes} minutos para confirmar o aceite:`,
      '',
      input.code,
      '',
      'Se voce nao solicitou este aceite, ignore este email e avise o suporte.',
    ].join('\n'),
  )
}

async function sendWhatsapp(settings: StoredNotificationSettings, phone: string, message: string, context: TemplateContext) {
  if (!settings.whatsappGatewayUrl || !phone) {
    throw new Error('WhatsApp sem URL do gateway ou telefone.')
  }

  const renderedBody = renderTemplate(settings.whatsappBodyTemplate, {
    ...context,
    telefone: phone,
    mensagem: message,
  })
  const headers: Record<string, string> = {}
  if (settings.whatsappToken) {
    headers[settings.whatsappTokenHeader || 'Authorization'] = settings.whatsappTokenHeader.toLowerCase() === 'authorization'
      ? `Bearer ${settings.whatsappToken}`
      : settings.whatsappToken
  }

  const response = await fetch(settings.whatsappGatewayUrl, settings.whatsappMethod === 'GET'
    ? { method: 'GET', headers }
    : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: renderedBody })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`WhatsApp gateway ${response.status}: ${text.slice(0, 300)}`)
  }
}

async function pendingNotifications(maxAttempts: number, rowLimit = 25) {
  await ensureNotificationDeliverySchema()
  return prisma.$queryRaw<QueueRow[]>`
    SELECT
      "AccessControlNotification".*,
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "Landlord"."name" AS "landlordName",
      "Landlord"."hubsoftPrimaryEmail" AS "hubsoftPrimaryEmail",
      "Landlord"."hubsoftPrimaryPhone" AS "hubsoftPrimaryPhone",
      "Landlord"."hubsoftSecondaryPhone" AS "hubsoftSecondaryPhone"
    FROM "AccessControlNotification"
    INNER JOIN "BillingAccount" ON "BillingAccount"."id" = "AccessControlNotification"."billingAccountId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "AccessControlNotification"."status" = 'pending'
      AND "AccessControlNotification"."attempts" < ${maxAttempts}
    ORDER BY "AccessControlNotification"."createdAt" ASC
    LIMIT ${rowLimit}
  `
}

export async function processNotificationQueue() {
  const settings = await storedNotificationSettings()
  await ensureNotificationDeliverySchema()
  const rows = await pendingNotifications(settings.maxAttempts)
  const result = { processed: 0, sent: 0, failed: 0, skipped: 0 }

  for (const row of rows) {
    result.processed += 1
    const details = parseDetails(row.details)
    const stage = row.stage in DEFAULT_TEMPLATES ? row.stage as NotificationTemplateStage : 'late_warning'
    const template = settings.templates[stage] ?? DEFAULT_TEMPLATES[stage]
    const email = row.hubsoftPrimaryEmail || row.userEmail || ''
    const phone = normalizePhone(row.hubsoftPrimaryPhone || row.hubsoftSecondaryPhone)
    const context: TemplateContext = {
      cliente: row.landlordName || row.userName || 'cliente',
      email,
      telefone: phone,
      dias_atraso: String(details.overdueDays ?? ''),
      empresa: settings.smtpFromName || 'Fireport',
      portal_url: process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '',
    }
    const message = renderTemplate(template.message || row.message, context)
    const subject = renderTemplate(template.emailSubject, context)
    const channels = (() => {
      try {
        const parsed = JSON.parse(row.channels)
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch {
        return []
      }
    })()

    const errors: string[] = []
    let delivered = 0
    let skipped = 0

    if (channels.includes('email')) {
      if (settings.emailEnabled) {
        try {
          await sendEmail(settings, email, subject, message)
          delivered += 1
        } catch (error) {
          errors.push(`email: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        skipped += 1
      }
    }

    if (channels.includes('whatsapp')) {
      if (settings.whatsappEnabled) {
        try {
          await sendWhatsapp(settings, phone, message, context)
          delivered += 1
        } catch (error) {
          errors.push(`whatsapp: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        skipped += 1
      }
    }

    const attempts = Number(row.attempts || 0) + 1
    const finalStatus = errors.length
      ? attempts >= settings.maxAttempts ? 'failed' : 'pending'
      : delivered > 0 || skipped > 0 ? 'sent' : 'failed'
    const lastError = errors.join(' | ') || (delivered || skipped ? null : 'Nenhum canal habilitado ou configurado.')

    await prisma.$executeRaw`
      UPDATE "AccessControlNotification"
      SET
        "status" = ${finalStatus},
        "attempts" = ${attempts},
        "lastAttemptAt" = ${new Date()},
        "lastError" = ${lastError},
        "sentAt" = CASE WHEN ${finalStatus} = 'sent' THEN ${new Date()} ELSE "sentAt" END
      WHERE "id" = ${row.id}
    `

    if (finalStatus === 'sent') result.sent += 1
    else if (finalStatus === 'failed') result.failed += 1
    else result.skipped += 1
  }

  return result
}
