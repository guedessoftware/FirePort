import { prisma } from './prisma'
import { syncAllHubsoftInvoices } from './billing'
import { assertActiveContractAccepted } from './contracts'

export const ACCESS_STATE_ACTIVE = 'active_normal'
export const ACCESS_STATE_FINANCIAL_PARTIAL = 'financial_partial_block'
export const ACCESS_STATE_FINANCIAL_TOTAL = 'financial_total_block'
export const ACCESS_STATE_ADMIN_PARTIAL = 'administrative_partial_block'
export const ACCESS_STATE_CONFIDENCE = 'confidence_release'
export const ACCESS_STATE_PENDING = 'pending_application'

type AccessState =
  | typeof ACCESS_STATE_ACTIVE
  | typeof ACCESS_STATE_FINANCIAL_PARTIAL
  | typeof ACCESS_STATE_FINANCIAL_TOTAL
  | typeof ACCESS_STATE_ADMIN_PARTIAL
  | typeof ACCESS_STATE_CONFIDENCE
  | typeof ACCESS_STATE_PENDING

type AccessControlRow = {
  id: string
  billingAccountId: string
  state: string
  financialState: string
  administrativeBlockActive: boolean | number
  administrativeBlockReason: string | null
  administrativeBlockDetails: string | null
  confidenceReleaseUntil: Date | string | null
  confidenceReleaseGrantedAt: Date | string | null
  confidenceReleaseGrantedByUserId: string | null
  overdueDays: number
  lastEvaluatedAt: Date | string | null
  pendingAction: string | null
  pendingError: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

type AccessBillingAccountRow = {
  id: string
  landlordId: string
  landlordName: string | null
  userId: string
  userName: string | null
  userEmail: string | null
}

type InvoiceStatusRow = {
  dueDate: Date | string | null
  status: string | null
}

type ContractReferenceRow = {
  contractId: string | null
  provisioningId: string | null
  onuReference: string | null
}

export type AccessControlStatus = {
  billingAccountId: string | null
  state: string
  financialState: string
  overdueDays: number
  administrativeBlockActive: boolean
  administrativeBlockReason: string | null
  confidenceReleaseUntil: string | null
  pendingAction: string | null
  pendingError: string | null
  canViewPortal: boolean
  canUseBilling: boolean
  canUseSupport: boolean
  canProvision: boolean
  canChangeData: boolean
  visibleTabs: string[]
  message: string
}

let accessControlSchemaReady: Promise<void> | null = null

function createLocalId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function iso(value: Date | string | null | undefined) {
  return asDate(value)?.toISOString() ?? null
}

function serializeDetails(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ serializationError: 'Nao foi possivel serializar os detalhes.' })
  }
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry)]),
    )
  }

  return value
}

function normalizeJsonRows<T>(rows: T): T {
  return normalizeJsonValue(rows) as T
}

async function tableExists(name: string) {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name" FROM sqlite_master WHERE "type" = 'table' AND "name" = ${name} LIMIT 1
  `

  return Boolean(rows[0])
}

export async function ensureAccessControlSchema() {
  accessControlSchemaReady ??= (async () => {
    if (!(await tableExists('ClientAccessControl'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ClientAccessControl" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "billingAccountId" TEXT NOT NULL,
          "state" TEXT NOT NULL DEFAULT 'active_normal',
          "financialState" TEXT NOT NULL DEFAULT 'active_normal',
          "administrativeBlockActive" BOOLEAN NOT NULL DEFAULT false,
          "administrativeBlockReason" TEXT,
          "administrativeBlockDetails" TEXT,
          "confidenceReleaseUntil" DATETIME,
          "confidenceReleaseGrantedAt" DATETIME,
          "confidenceReleaseGrantedByUserId" TEXT,
          "overdueDays" INTEGER NOT NULL DEFAULT 0,
          "lastEvaluatedAt" DATETIME,
          "pendingAction" TEXT,
          "pendingError" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "ClientAccessControl_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "ClientAccessControl_confidenceReleaseGrantedByUserId_fkey" FOREIGN KEY ("confidenceReleaseGrantedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
    }
    if (!(await tableExists('AccessControlAudit'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "AccessControlAudit" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "billingAccountId" TEXT NOT NULL,
          "userId" TEXT,
          "origin" TEXT NOT NULL,
          "action" TEXT NOT NULL,
          "reason" TEXT NOT NULL,
          "previousState" TEXT,
          "nextState" TEXT,
          "contractId" TEXT,
          "provisioningId" TEXT,
          "onuReference" TEXT,
          "ruleApplied" TEXT,
          "result" TEXT NOT NULL DEFAULT 'success',
          "details" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "AccessControlAudit_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "AccessControlAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
    }
    if (!(await tableExists('AccessControlNotification'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "AccessControlNotification" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "billingAccountId" TEXT NOT NULL,
          "stage" TEXT NOT NULL,
          "channels" TEXT NOT NULL,
          "message" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'pending',
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "lastAttemptAt" DATETIME,
          "lastError" TEXT,
          "details" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "sentAt" DATETIME,
          CONSTRAINT "AccessControlNotification_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `)
    }

    const statements = [
      'CREATE UNIQUE INDEX IF NOT EXISTS "ClientAccessControl_billingAccountId_key" ON "ClientAccessControl"("billingAccountId")',
      'CREATE INDEX IF NOT EXISTS "ClientAccessControl_state_idx" ON "ClientAccessControl"("state")',
      'CREATE INDEX IF NOT EXISTS "ClientAccessControl_financialState_idx" ON "ClientAccessControl"("financialState")',
      'CREATE INDEX IF NOT EXISTS "ClientAccessControl_administrativeBlockActive_idx" ON "ClientAccessControl"("administrativeBlockActive")',
      'CREATE INDEX IF NOT EXISTS "ClientAccessControl_pendingAction_idx" ON "ClientAccessControl"("pendingAction")',
      'CREATE INDEX IF NOT EXISTS "AccessControlAudit_billingAccountId_idx" ON "AccessControlAudit"("billingAccountId")',
      'CREATE INDEX IF NOT EXISTS "AccessControlAudit_userId_idx" ON "AccessControlAudit"("userId")',
      'CREATE INDEX IF NOT EXISTS "AccessControlAudit_origin_idx" ON "AccessControlAudit"("origin")',
      'CREATE INDEX IF NOT EXISTS "AccessControlAudit_action_idx" ON "AccessControlAudit"("action")',
      'CREATE INDEX IF NOT EXISTS "AccessControlAudit_result_idx" ON "AccessControlAudit"("result")',
      'CREATE INDEX IF NOT EXISTS "AccessControlAudit_createdAt_idx" ON "AccessControlAudit"("createdAt")',
      'CREATE INDEX IF NOT EXISTS "AccessControlNotification_billingAccountId_idx" ON "AccessControlNotification"("billingAccountId")',
      'CREATE INDEX IF NOT EXISTS "AccessControlNotification_stage_idx" ON "AccessControlNotification"("stage")',
      'CREATE INDEX IF NOT EXISTS "AccessControlNotification_status_idx" ON "AccessControlNotification"("status")',
      'CREATE INDEX IF NOT EXISTS "AccessControlNotification_createdAt_idx" ON "AccessControlNotification"("createdAt")',
    ]

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement)
    }
  })().catch((error) => {
    accessControlSchemaReady = null
    throw error
  })

  return accessControlSchemaReady
}

async function ensureAccountControl(billingAccountId: string) {
  await ensureAccessControlSchema()
  const existing = await prisma.$queryRaw<AccessControlRow[]>`
    SELECT * FROM "ClientAccessControl" WHERE "billingAccountId" = ${billingAccountId} LIMIT 1
  `
  if (existing[0]) return existing[0]

  const id = createLocalId('access_control')
  await prisma.$executeRaw`
    INSERT INTO "ClientAccessControl" (
      "id",
      "billingAccountId",
      "state",
      "financialState",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${billingAccountId},
      ${ACCESS_STATE_ACTIVE},
      ${ACCESS_STATE_ACTIVE},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  const rows = await prisma.$queryRaw<AccessControlRow[]>`
    SELECT * FROM "ClientAccessControl" WHERE "billingAccountId" = ${billingAccountId} LIMIT 1
  `

  return rows[0]
}

async function auditAccessControl(input: {
  billingAccountId: string
  userId?: string | null
  origin: 'manual' | 'automatic'
  action: string
  reason: string
  previousState?: string | null
  nextState?: string | null
  contractId?: string | null
  provisioningId?: string | null
  onuReference?: string | null
  ruleApplied?: string | null
  result?: 'success' | 'error' | 'pending'
  details?: unknown
}) {
  await ensureAccessControlSchema()
  const id = createLocalId('access_audit')
  await prisma.$executeRaw`
    INSERT INTO "AccessControlAudit" (
      "id",
      "billingAccountId",
      "userId",
      "origin",
      "action",
      "reason",
      "previousState",
      "nextState",
      "contractId",
      "provisioningId",
      "onuReference",
      "ruleApplied",
      "result",
      "details",
      "createdAt"
    ) VALUES (
      ${id},
      ${input.billingAccountId},
      ${input.userId ?? null},
      ${input.origin},
      ${input.action},
      ${input.reason},
      ${input.previousState ?? null},
      ${input.nextState ?? null},
      ${input.contractId ?? null},
      ${input.provisioningId ?? null},
      ${input.onuReference ?? null},
      ${input.ruleApplied ?? null},
      ${input.result ?? 'success'},
      ${input.details === undefined ? null : serializeDetails(input.details)},
      CURRENT_TIMESTAMP
    )
  `
}

function financialStateForOverdueDays(overdueDays: number): AccessState {
  if (overdueDays >= 15) return ACCESS_STATE_FINANCIAL_TOTAL
  if (overdueDays >= 10) return ACCESS_STATE_FINANCIAL_PARTIAL
  return ACCESS_STATE_ACTIVE
}

function notificationStageForOverdueDays(overdueDays: number) {
  if (overdueDays >= 15) return 'financial_total_block'
  if (overdueDays >= 10) return 'financial_partial_block'
  if (overdueDays >= 5) return 'suspension_warning'
  if (overdueDays >= 3) return 'late_warning'
  return null
}

function notificationMessage(stage: string, overdueDays: number) {
  if (stage === 'financial_total_block') {
    return `Sua conta esta com ${overdueDays} dias de atraso e o acesso foi suspenso. Acesse suas faturas para regularizar.`
  }
  if (stage === 'financial_partial_block') {
    return `Sua conta esta com ${overdueDays} dias de atraso. Novas alteracoes e provisionamentos estao bloqueados ate a regularizacao.`
  }
  if (stage === 'suspension_warning') {
    return `Sua conta esta com ${overdueDays} dias de atraso e podera ser suspensa se nao houver pagamento.`
  }

  return `Identificamos ${overdueDays} dias de atraso. Regularize suas faturas para evitar bloqueios.`
}

function isPaidStatus(status: string | null) {
  const normalized = String(status ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalized === 'paid' || normalized === 'paga' || normalized === 'pago'
}

function calculateOverdueDays(invoices: InvoiceStatusRow[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let maxDays = 0

  for (const invoice of invoices) {
    if (!invoice.dueDate || isPaidStatus(invoice.status)) continue
    const dueDate = asDate(invoice.dueDate)
    if (!dueDate) continue
    const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime()
    const days = Math.floor((today - dueDay) / 86_400_000)
    if (days > maxDays) maxDays = days
  }

  return maxDays
}

async function getInvoicesForAccount(billingAccountId: string) {
  return prisma.$queryRaw<InvoiceStatusRow[]>`
    SELECT "dueDate", "status"
    FROM "HubsoftInvoiceSnapshot"
    WHERE "billingAccountId" = ${billingAccountId}
  `
}

async function firstContractReference(billingAccountId: string): Promise<ContractReferenceRow> {
  const rows = await prisma.$queryRaw<ContractReferenceRow[]>`
    SELECT
      "BillingService"."contractId" AS "contractId",
      "BillingService"."provisioningId" AS "provisioningId",
      "BillingService"."serial" AS "onuReference"
    FROM "BillingService"
    WHERE "BillingService"."billingAccountId" = ${billingAccountId}
      AND "BillingService"."status" = 'active'
    ORDER BY "BillingService"."activatedAt" DESC
    LIMIT 1
  `

  return rows[0] ?? { contractId: null, provisioningId: null, onuReference: null }
}

function resolveEffectiveState(control: AccessControlRow, financialState: AccessState, now = new Date()): AccessState {
  if (Boolean(control.administrativeBlockActive)) return ACCESS_STATE_ADMIN_PARTIAL

  const confidenceUntil = asDate(control.confidenceReleaseUntil)
  if (confidenceUntil && confidenceUntil > now) return ACCESS_STATE_CONFIDENCE

  return financialState
}

function statusMessage(state: string, overdueDays: number) {
  if (state === ACCESS_STATE_PENDING) return 'Ha uma acao de controle de acesso pendente de aplicacao.'
  if (state === ACCESS_STATE_ADMIN_PARTIAL) return 'Acesso parcialmente bloqueado por regra administrativa.'
  if (state === ACCESS_STATE_CONFIDENCE) return 'Acesso liberado em confianca temporariamente.'
  if (state === ACCESS_STATE_FINANCIAL_TOTAL) return 'Acesso suspenso por atraso. Faturas e suporte continuam disponiveis.'
  if (state === ACCESS_STATE_FINANCIAL_PARTIAL) return 'Acesso parcialmente bloqueado por atraso. Novas alteracoes estao indisponiveis.'
  if (overdueDays >= 5) return 'Existe aviso de suspensao por atraso financeiro.'
  if (overdueDays >= 3) return 'Existe aviso de atraso financeiro.'
  return 'Acesso normal.'
}

export function accessPermissions(status: Pick<AccessControlStatus, 'state' | 'pendingAction'>) {
  const total = status.state === ACCESS_STATE_FINANCIAL_TOTAL
  const partial = status.state === ACCESS_STATE_FINANCIAL_PARTIAL || status.state === ACCESS_STATE_ADMIN_PARTIAL
  const pending = Boolean(status.pendingAction)

  return {
    canViewPortal: true,
    canUseBilling: true,
    canUseSupport: true,
    canProvision: !total && !partial && !pending,
    canChangeData: !total && !partial && !pending,
    visibleTabs: total ? ['billing', 'alerts'] : ['dashboard', 'provisionings', 'onus', 'billing', 'alerts'],
  }
}

function buildStatus(control: AccessControlRow | null, billingAccountId: string | null): AccessControlStatus {
  const state = control?.state ?? ACCESS_STATE_ACTIVE
  const overdueDays = Number(control?.overdueDays ?? 0)
  const permissions = accessPermissions({ state, pendingAction: control?.pendingAction ?? null })

  return {
    billingAccountId,
    state,
    financialState: control?.financialState ?? ACCESS_STATE_ACTIVE,
    overdueDays,
    administrativeBlockActive: Boolean(control?.administrativeBlockActive),
    administrativeBlockReason: control?.administrativeBlockReason ?? null,
    confidenceReleaseUntil: iso(control?.confidenceReleaseUntil),
    pendingAction: control?.pendingAction ?? null,
    pendingError: control?.pendingError ?? null,
    ...permissions,
    message: statusMessage(state, overdueDays),
  }
}

async function queueAccessNotification(input: {
  billingAccountId: string
  stage: string
  overdueDays: number
}) {
  const id = createLocalId('access_notification')
  await prisma.$executeRaw`
    INSERT INTO "AccessControlNotification" (
      "id",
      "billingAccountId",
      "stage",
      "channels",
      "message",
      "status",
      "details",
      "createdAt"
    ) VALUES (
      ${id},
      ${input.billingAccountId},
      ${input.stage},
      ${JSON.stringify(['whatsapp', 'email'])},
      ${notificationMessage(input.stage, input.overdueDays)},
      'pending',
      ${serializeDetails({ overdueDays: input.overdueDays })},
      CURRENT_TIMESTAMP
    )
  `
}

export async function evaluateAccessControlForAccount(input: {
  billingAccountId: string
  origin?: 'manual' | 'automatic'
  userId?: string | null
  sendNotifications?: boolean
  reason?: string
}) {
  await ensureAccessControlSchema()
  const control = await ensureAccountControl(input.billingAccountId)
  const invoices = await getInvoicesForAccount(input.billingAccountId)
  const overdueDays = calculateOverdueDays(invoices)
  const financialState = financialStateForOverdueDays(overdueDays)
  const effectiveState = resolveEffectiveState(control, financialState)
  const reference = await firstContractReference(input.billingAccountId)

  try {
    await prisma.$executeRaw`
      UPDATE "ClientAccessControl"
      SET
        "state" = ${effectiveState},
        "financialState" = ${financialState},
        "overdueDays" = ${overdueDays},
        "lastEvaluatedAt" = ${new Date()},
        "pendingAction" = NULL,
        "pendingError" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "billingAccountId" = ${input.billingAccountId}
    `

    if (control.state !== effectiveState || control.financialState !== financialState) {
      await auditAccessControl({
        billingAccountId: input.billingAccountId,
        userId: input.userId,
        origin: input.origin ?? 'automatic',
        action: 'evaluate_access_rule',
        reason: input.reason ?? 'Regua financeira aplicada a partir das faturas Hubsoft.',
        previousState: control.state,
        nextState: effectiveState,
        contractId: reference.contractId,
        provisioningId: reference.provisioningId,
        onuReference: reference.onuReference,
        ruleApplied: `overdue_days_${overdueDays}`,
        details: { overdueDays, financialState, effectiveState },
      })
    }

    const stage = notificationStageForOverdueDays(overdueDays)
    if (input.sendNotifications && stage) {
      await queueAccessNotification({
        billingAccountId: input.billingAccountId,
        stage,
        overdueDays,
      })
      await auditAccessControl({
        billingAccountId: input.billingAccountId,
        userId: input.userId,
        origin: input.origin ?? 'automatic',
        action: 'queue_access_notification',
        reason: 'Aviso repetido por WhatsApp e email conforme regua de atraso.',
        previousState: effectiveState,
        nextState: effectiveState,
        contractId: reference.contractId,
        provisioningId: reference.provisioningId,
        onuReference: reference.onuReference,
        ruleApplied: stage,
        result: 'pending',
        details: { channels: ['whatsapp', 'email'], overdueDays },
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.$executeRaw`
      UPDATE "ClientAccessControl"
      SET
        "state" = ${ACCESS_STATE_PENDING},
        "pendingAction" = 'evaluate_access_rule',
        "pendingError" = ${message},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "billingAccountId" = ${input.billingAccountId}
    `
    await auditAccessControl({
      billingAccountId: input.billingAccountId,
      userId: input.userId,
      origin: input.origin ?? 'automatic',
      action: 'evaluate_access_rule',
      reason: 'Falha ao aplicar regra de controle de acesso.',
      previousState: control.state,
      nextState: ACCESS_STATE_PENDING,
      ruleApplied: `overdue_days_${overdueDays}`,
      result: 'pending',
      details: { error: message },
    })
  }

  const updated = await ensureAccountControl(input.billingAccountId)
  return buildStatus(updated, input.billingAccountId)
}

export async function evaluateAllAccessControls(input: {
  sendNotifications?: boolean
  syncHubsoft?: boolean
  origin?: 'manual' | 'automatic'
  userId?: string | null
} = {}) {
  await ensureAccessControlSchema()
  const syncResult = input.syncHubsoft ? await syncAllHubsoftInvoices() : null
  const accounts = await prisma.$queryRaw<AccessBillingAccountRow[]>`
    SELECT
      "BillingAccount"."id",
      "BillingAccount"."landlordId",
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "User"."role" <> 'admin'
    ORDER BY "BillingAccount"."createdAt" ASC
  `
  const result = { accounts: 0, changed: 0, pending: 0, sync: syncResult, errors: 0 }

  for (const account of accounts) {
    try {
      const before = await ensureAccountControl(account.id)
      const status = await evaluateAccessControlForAccount({
        billingAccountId: account.id,
        origin: input.origin ?? 'automatic',
        userId: input.userId,
        sendNotifications: input.sendNotifications,
      })
      result.accounts += 1
      if (before.state !== status.state || before.financialState !== status.financialState) {
        result.changed += 1
      }
      if (status.pendingAction) result.pending += 1
    } catch (error) {
      result.errors += 1
      console.error('[ACCESS CONTROL] falha ao avaliar conta', account.id, error)
    }
  }

  return result
}

export async function getAccessControlForUser(userId: string) {
  await ensureAccessControlSchema()
  const accountRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "BillingAccount"."id"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    WHERE "Landlord"."userId" = ${userId}
    LIMIT 1
  `
  const accountId = accountRows[0]?.id ?? null
  if (!accountId) return buildStatus(null, null)

  const control = await ensureAccountControl(accountId)
  return buildStatus(control, accountId)
}

export async function assertPortalMutationAllowed(userId: string, action: 'provision' | 'change_data') {
  await assertActiveContractAccepted(userId)
  const status = await getAccessControlForUser(userId)
  const allowed = action === 'provision' ? status.canProvision : status.canChangeData
  if (allowed) return status

  const message = action === 'provision'
    ? 'Seu acesso nao permite novos provisionamentos no momento.'
    : 'Seu acesso nao permite alterar dados no momento.'
  const error = new Error(`${message} ${status.message}`)
  error.name = 'AccessControlError'
  throw error
}

export async function listAccessControls() {
  await ensureAccessControlSchema()
  const rows = await prisma.$queryRaw`
    SELECT
      "BillingAccount"."id" AS "billingAccountId",
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "ClientAccessControl"."state",
      "ClientAccessControl"."financialState",
      "ClientAccessControl"."administrativeBlockActive",
      "ClientAccessControl"."administrativeBlockReason",
      "ClientAccessControl"."confidenceReleaseUntil",
      "ClientAccessControl"."overdueDays",
      "ClientAccessControl"."lastEvaluatedAt",
      "ClientAccessControl"."pendingAction",
      "ClientAccessControl"."pendingError",
      COUNT("AccessControlNotification"."id") AS "pendingNotificationCount"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    LEFT JOIN "ClientAccessControl" ON "ClientAccessControl"."billingAccountId" = "BillingAccount"."id"
    LEFT JOIN "AccessControlNotification" ON "AccessControlNotification"."billingAccountId" = "BillingAccount"."id"
      AND "AccessControlNotification"."status" = 'pending'
    WHERE "User"."role" <> 'admin'
    GROUP BY "BillingAccount"."id"
    ORDER BY
      CASE WHEN "ClientAccessControl"."pendingAction" IS NOT NULL THEN 0 ELSE 1 END,
      "ClientAccessControl"."overdueDays" DESC,
      "Landlord"."name" ASC
  `

  return normalizeJsonRows(rows)
}

export async function setAdministrativeBlock(input: {
  billingAccountId: string
  active: boolean
  reason?: string | null
  details?: string | null
  userId: string
}) {
  const control = await ensureAccountControl(input.billingAccountId)
  await prisma.$executeRaw`
    UPDATE "ClientAccessControl"
    SET
      "administrativeBlockActive" = ${input.active},
      "administrativeBlockReason" = ${input.active ? input.reason || 'administrative' : null},
      "administrativeBlockDetails" = ${input.active ? input.details ?? null : null},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "billingAccountId" = ${input.billingAccountId}
  `
  const status = await evaluateAccessControlForAccount({
    billingAccountId: input.billingAccountId,
    origin: 'manual',
    userId: input.userId,
    reason: input.active ? 'Bloqueio administrativo parcial aplicado manualmente.' : 'Bloqueio administrativo removido manualmente.',
  })
  await auditAccessControl({
    billingAccountId: input.billingAccountId,
    userId: input.userId,
    origin: 'manual',
    action: input.active ? 'apply_administrative_partial_block' : 'remove_administrative_partial_block',
    reason: input.reason || (input.active ? 'Bloqueio administrativo.' : 'Remocao de bloqueio administrativo.'),
    previousState: control.state,
    nextState: status.state,
    ruleApplied: 'administrative_partial_block',
    details: { details: input.details ?? null },
  })

  return status
}

export async function grantConfidenceRelease(input: {
  billingAccountId: string
  userId: string
  reason?: string | null
}) {
  const control = await ensureAccountControl(input.billingAccountId)
  if (Boolean(control.administrativeBlockActive)) {
    throw new Error('Cliente com bloqueio administrativo ativo nao pode receber liberacao em confianca.')
  }

  const lastConfidence = await prisma.$queryRaw<Array<{ createdAt: Date | string }>>`
    SELECT "createdAt"
    FROM "AccessControlAudit"
    WHERE "billingAccountId" = ${input.billingAccountId}
      AND "action" = 'grant_confidence_release'
      AND "result" = 'success'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `
  const lastDate = asDate(lastConfidence[0]?.createdAt)
  if (lastDate && Date.now() - lastDate.getTime() < 30 * 86_400_000) {
    throw new Error('Liberacao em confianca ja usada nos ultimos 30 dias.')
  }

  const now = new Date()
  const until = new Date(now.getTime() + 3 * 86_400_000)
  await prisma.$executeRaw`
    UPDATE "ClientAccessControl"
    SET
      "confidenceReleaseUntil" = ${until},
      "confidenceReleaseGrantedAt" = ${now},
      "confidenceReleaseGrantedByUserId" = ${input.userId},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "billingAccountId" = ${input.billingAccountId}
  `

  const status = await evaluateAccessControlForAccount({
    billingAccountId: input.billingAccountId,
    origin: 'manual',
    userId: input.userId,
    reason: 'Liberacao em confianca aplicada por 3 dias.',
  })
  await auditAccessControl({
    billingAccountId: input.billingAccountId,
    userId: input.userId,
    origin: 'manual',
    action: 'grant_confidence_release',
    reason: input.reason || 'Liberacao em confianca por 3 dias.',
    previousState: control.state,
    nextState: status.state,
    ruleApplied: 'confidence_release_3_days',
    details: { until: until.toISOString() },
  })

  return status
}
