import { prisma } from './prisma'
import {
  fetchHubsoftInvoicesByCnpj,
  fetchHubsoftInvoicesByClientId,
  fetchHubsoftInvoicesByClientServiceId,
  type HubsoftInvoice,
} from './hubsoft'

const BILLING_SETTINGS_KEY = 'billingSettings'
const HUBSOFT_SERVICE_NAME = 'Servico de Rede Neutra'

export type BillingSettings = {
  closingDay: number
  automaticClosingEnabled: boolean
  lastAutomaticClosingAt: string | null
  lastAutomaticClosingCompetence: string | null
  lastAutomaticClosingError: string | null
  defaultDueDay: number
  defaultMinimumAmountCents: number
  defaultIncludedProvisionings: number
  defaultExtraProvisioningAmountCents: number
  defaultBillingMethod: string
  defaultChargeType: string
  defaultInstallationFeeCents: number
  defaultInstallationInstallments: number
  defaultContractTermMonths: number
}

export type UpdateBillingSettingsInput = Partial<{
  closingDay: unknown
  automaticClosingEnabled: unknown
  defaultDueDay: unknown
  defaultMinimumAmountCents: unknown
  defaultIncludedProvisionings: unknown
  defaultExtraProvisioningAmountCents: unknown
  defaultBillingMethod: unknown
  defaultChargeType: unknown
  defaultInstallationFeeCents: unknown
  defaultInstallationInstallments: unknown
  defaultContractTermMonths: unknown
}>

type BillingPlanRow = {
  id: string
  defaultMinimumAmountCents: number
  defaultIncludedProvisionings: number
  defaultExtraProvisioningAmountCents: number
}

type BillingAccountRow = {
  id: string
  landlordId: string
  hubsoftClientServiceId: string | null
  hubsoftServiceName: string
  billingPlanId: string | null
  minimumAmountCents: number
  includedProvisionings: number
  extraProvisioningAmountCents: number
  dueDay: number
  firstActivationAt: Date | string | null
  billingStartedAt: Date | string | null
  status: string
  notes: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

type BillingCycleRow = {
  id: string
  year: number
  month: number
  competence: string
  periodStart: Date | string
  periodEnd: Date | string
  closingAt: Date | string
  status: string
}

type BillingRunRow = {
  id: string
  billingCycleId: string
  billingAccountId: string
  competence: string
  hubsoftClientServiceId: string | null
  dueDay: number
  activeProvisioningCount: number
  includedProvisioningCount: number
  extraProvisioningCount: number
  minimumAmountCents: number
  extraAmountCents: number
  penaltyAmountCents: number
  totalAmountCents: number
  status: string
  idempotencyKey: string
}

type BillingServiceRow = {
  id: string
  billingAccountId: string
  provisioningId: string
  contractId: string
  contractNumber: string
  portId: string
  ctoId: string
  serial: string
  activatedAt: Date | string
  canceledAt: Date | string | null
}

type BillingPenaltyRow = {
  id: string
  amountCents: number
  reason: string
}

type BillingInvoiceAccountRow = {
  id: string
  hubsoftClientServiceId: string | null
  document?: string | null
  hubsoftClientId?: string | null
}

const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  closingDay: 25,
  automaticClosingEnabled: false,
  lastAutomaticClosingAt: null,
  lastAutomaticClosingCompetence: null,
  lastAutomaticClosingError: null,
  defaultDueDay: 10,
  defaultMinimumAmountCents: 0,
  defaultIncludedProvisionings: 0,
  defaultExtraProvisioningAmountCents: 0,
  defaultBillingMethod: 'Boleto bancario',
  defaultChargeType: 'Mensalidade recorrente',
  defaultInstallationFeeCents: 0,
  defaultInstallationInstallments: 1,
  defaultContractTermMonths: 12,
}

function createLocalId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function parseStoredSettings(value?: string | null): Partial<BillingSettings> {
  if (!value) return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeDay(value: unknown, fallback: number) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(Math.max(number, 1), 28)
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return fallback
  return number
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function normalizeNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeOptionalText(value: unknown, fallback: string | null, maxLength: number) {
  if (value === undefined) return fallback
  if (value === null || value === '') return null
  return String(value).trim().slice(0, maxLength) || null
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

function monthCompetence(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function periodStart(year: number, month: number) {
  return new Date(year, month - 1, 1, 0, 0, 0, 0)
}

function periodEnd(year: number, month: number) {
  return new Date(year, month, 0, 23, 59, 59, 999)
}

function closingAt(year: number, month: number, closingDay: number) {
  const lastDay = new Date(year, month, 0).getDate()
  return new Date(year, month - 1, Math.min(closingDay, lastDay), 23, 59, 59, 999)
}

function buildRunDescription(run: BillingRunRow) {
  return [
    `Fireport Rede Neutra - Competencia ${run.competence}`,
    `${run.activeProvisioningCount} provisionamentos ativos`,
    `${run.includedProvisioningCount} inclusos`,
    `${run.extraProvisioningCount} excedentes`,
    `multas R$ ${(run.penaltyAmountCents / 100).toFixed(2)}`,
  ].join(' - ')
}

function moneyToCents(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 100)
}

function invoiceCompetence(invoice: HubsoftInvoice) {
  return invoice.dueDate ? invoice.dueDate.slice(0, 7) : null
}

function parseHubsoftDate(value: string | null) {
  if (!value) return null
  const normalized = value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

async function readSettings() {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${BILLING_SETTINGS_KEY} LIMIT 1
  `

  return parseStoredSettings(rows[0]?.value)
}

async function writeSettings(settings: BillingSettings) {
  const id = createLocalId('billing_settings')
  const value = JSON.stringify(settings)
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("id", "key", "value", "createdAt", "updatedAt")
    VALUES (${id}, ${BILLING_SETTINGS_KEY}, ${value}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT("key") DO UPDATE SET
      "value" = excluded."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `
}

async function findDefaultBillingPlan() {
  const rows = await prisma.$queryRaw<BillingPlanRow[]>`
    SELECT
      "id",
      "defaultMinimumAmountCents",
      "defaultIncludedProvisionings",
      "defaultExtraProvisioningAmountCents"
    FROM "BillingPlan"
    WHERE "isDefault" = true
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `

  return rows[0] ?? null
}

async function findBillingAccountById(id: string) {
  const rows = await prisma.$queryRaw<BillingAccountRow[]>`
    SELECT * FROM "BillingAccount" WHERE "id" = ${id} LIMIT 1
  `

  return rows[0] ?? null
}

async function findBillingAccountByLandlordId(landlordId: string) {
  const rows = await prisma.$queryRaw<BillingAccountRow[]>`
    SELECT * FROM "BillingAccount" WHERE "landlordId" = ${landlordId} LIMIT 1
  `

  return rows[0] ?? null
}

async function findBillingCycleByCompetence(competence: string) {
  const rows = await prisma.$queryRaw<BillingCycleRow[]>`
    SELECT * FROM "BillingCycle" WHERE "competence" = ${competence} LIMIT 1
  `

  return rows[0] ?? null
}

async function findBillingRunByAccountCompetence(accountId: string, competence: string) {
  const rows = await prisma.$queryRaw<BillingRunRow[]>`
    SELECT *
    FROM "BillingRun"
    WHERE "billingAccountId" = ${accountId}
      AND "competence" = ${competence}
    LIMIT 1
  `

  return rows[0] ?? null
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const stored = await readSettings()

  return {
    closingDay: normalizeDay(stored.closingDay, DEFAULT_BILLING_SETTINGS.closingDay),
    automaticClosingEnabled: normalizeBoolean(
      stored.automaticClosingEnabled,
      DEFAULT_BILLING_SETTINGS.automaticClosingEnabled,
    ),
    lastAutomaticClosingAt: normalizeNullableString(stored.lastAutomaticClosingAt),
    lastAutomaticClosingCompetence: normalizeNullableString(stored.lastAutomaticClosingCompetence),
    lastAutomaticClosingError: normalizeNullableString(stored.lastAutomaticClosingError),
    defaultDueDay: normalizeDay(stored.defaultDueDay, DEFAULT_BILLING_SETTINGS.defaultDueDay),
    defaultMinimumAmountCents: normalizeNonNegativeInteger(
      stored.defaultMinimumAmountCents,
      DEFAULT_BILLING_SETTINGS.defaultMinimumAmountCents,
    ),
    defaultIncludedProvisionings: normalizeNonNegativeInteger(
      stored.defaultIncludedProvisionings,
      DEFAULT_BILLING_SETTINGS.defaultIncludedProvisionings,
    ),
    defaultExtraProvisioningAmountCents: normalizeNonNegativeInteger(
      stored.defaultExtraProvisioningAmountCents,
      DEFAULT_BILLING_SETTINGS.defaultExtraProvisioningAmountCents,
    ),
    defaultBillingMethod: normalizeOptionalText(stored.defaultBillingMethod, DEFAULT_BILLING_SETTINGS.defaultBillingMethod, 80) || DEFAULT_BILLING_SETTINGS.defaultBillingMethod,
    defaultChargeType: normalizeOptionalText(stored.defaultChargeType, DEFAULT_BILLING_SETTINGS.defaultChargeType, 80) || DEFAULT_BILLING_SETTINGS.defaultChargeType,
    defaultInstallationFeeCents: normalizeNonNegativeInteger(
      stored.defaultInstallationFeeCents,
      DEFAULT_BILLING_SETTINGS.defaultInstallationFeeCents,
    ),
    defaultInstallationInstallments: Math.max(1, normalizeNonNegativeInteger(
      stored.defaultInstallationInstallments,
      DEFAULT_BILLING_SETTINGS.defaultInstallationInstallments,
    )),
    defaultContractTermMonths: Math.max(1, normalizeNonNegativeInteger(
      stored.defaultContractTermMonths,
      DEFAULT_BILLING_SETTINGS.defaultContractTermMonths,
    )),
  }
}

export async function updateBillingSettings(input: UpdateBillingSettingsInput) {
  const current = await getBillingSettings()
  const settings: BillingSettings = {
    closingDay: normalizeDay(input.closingDay, current.closingDay),
    automaticClosingEnabled: normalizeBoolean(input.automaticClosingEnabled, current.automaticClosingEnabled),
    lastAutomaticClosingAt: current.lastAutomaticClosingAt,
    lastAutomaticClosingCompetence: current.lastAutomaticClosingCompetence,
    lastAutomaticClosingError: current.lastAutomaticClosingError,
    defaultDueDay: normalizeDay(input.defaultDueDay, current.defaultDueDay),
    defaultMinimumAmountCents: normalizeNonNegativeInteger(
      input.defaultMinimumAmountCents,
      current.defaultMinimumAmountCents,
    ),
    defaultIncludedProvisionings: normalizeNonNegativeInteger(
      input.defaultIncludedProvisionings,
      current.defaultIncludedProvisionings,
    ),
    defaultExtraProvisioningAmountCents: normalizeNonNegativeInteger(
      input.defaultExtraProvisioningAmountCents,
      current.defaultExtraProvisioningAmountCents,
    ),
    defaultBillingMethod: normalizeOptionalText(input.defaultBillingMethod, current.defaultBillingMethod, 80) || DEFAULT_BILLING_SETTINGS.defaultBillingMethod,
    defaultChargeType: normalizeOptionalText(input.defaultChargeType, current.defaultChargeType, 80) || DEFAULT_BILLING_SETTINGS.defaultChargeType,
    defaultInstallationFeeCents: normalizeNonNegativeInteger(
      input.defaultInstallationFeeCents,
      current.defaultInstallationFeeCents,
    ),
    defaultInstallationInstallments: Math.max(1, normalizeNonNegativeInteger(
      input.defaultInstallationInstallments,
      current.defaultInstallationInstallments,
    )),
    defaultContractTermMonths: Math.max(1, normalizeNonNegativeInteger(
      input.defaultContractTermMonths,
      current.defaultContractTermMonths,
    )),
  }

  await writeSettings(settings)
  await ensureDefaultBillingPlan(settings)

  return settings
}

export async function saveAutomaticBillingClosingResult(input: {
  competence: string
  closedAt?: Date
  error?: unknown
}) {
  const current = await getBillingSettings()
  const settings: BillingSettings = {
    ...current,
    lastAutomaticClosingAt: (input.closedAt ?? new Date()).toISOString(),
    lastAutomaticClosingCompetence: input.competence,
    lastAutomaticClosingError: input.error instanceof Error
      ? input.error.message
      : input.error
        ? String(input.error)
        : null,
  }

  await writeSettings(settings)
  return settings
}

export async function ensureDefaultBillingPlan(settings?: BillingSettings) {
  const safeSettings = settings ?? await getBillingSettings()
  const current = await findDefaultBillingPlan()

  if (current) {
    await prisma.$executeRaw`
      UPDATE "BillingPlan"
      SET
        "name" = 'Padrao Rede Neutra',
        "description" = 'Plano padrao usado para novas contas financeiras da rede neutra.',
        "defaultMinimumAmountCents" = ${safeSettings.defaultMinimumAmountCents},
        "defaultIncludedProvisionings" = ${safeSettings.defaultIncludedProvisionings},
        "defaultExtraProvisioningAmountCents" = ${safeSettings.defaultExtraProvisioningAmountCents},
        "isDefault" = true,
        "isActive" = true,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${current.id}
    `

    return {
      ...current,
      defaultMinimumAmountCents: safeSettings.defaultMinimumAmountCents,
      defaultIncludedProvisionings: safeSettings.defaultIncludedProvisionings,
      defaultExtraProvisioningAmountCents: safeSettings.defaultExtraProvisioningAmountCents,
    }
  }

  const id = createLocalId('billing_plan')
  await prisma.$executeRaw`
    INSERT INTO "BillingPlan" (
      "id",
      "name",
      "description",
      "defaultMinimumAmountCents",
      "defaultIncludedProvisionings",
      "defaultExtraProvisioningAmountCents",
      "isDefault",
      "isActive",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      'Padrao Rede Neutra',
      'Plano padrao usado para novas contas financeiras da rede neutra.',
      ${safeSettings.defaultMinimumAmountCents},
      ${safeSettings.defaultIncludedProvisionings},
      ${safeSettings.defaultExtraProvisioningAmountCents},
      true,
      true,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  return {
    id,
    defaultMinimumAmountCents: safeSettings.defaultMinimumAmountCents,
    defaultIncludedProvisionings: safeSettings.defaultIncludedProvisionings,
    defaultExtraProvisioningAmountCents: safeSettings.defaultExtraProvisioningAmountCents,
  }
}

export async function ensureBillingAccountForLandlord(landlordId: string) {
  const landlordUsers = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT "User"."role"
    FROM "Landlord"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "Landlord"."id" = ${landlordId}
    LIMIT 1
  `
  if (landlordUsers[0]?.role === 'admin') {
    throw new Error('Usuarios do sistema nao devem possuir conta financeira.')
  }

  const existing = await findBillingAccountByLandlordId(landlordId)
  if (existing) return existing

  const settings = await getBillingSettings()
  const plan = await ensureDefaultBillingPlan(settings)
  const id = createLocalId('billing_account')
  await prisma.$executeRaw`
    INSERT INTO "BillingAccount" (
      "id",
      "landlordId",
      "hubsoftServiceName",
      "billingPlanId",
      "minimumAmountCents",
      "includedProvisionings",
      "extraProvisioningAmountCents",
      "dueDay",
      "status",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${landlordId},
      ${HUBSOFT_SERVICE_NAME},
      ${plan.id},
      ${plan.defaultMinimumAmountCents},
      ${plan.defaultIncludedProvisionings},
      ${plan.defaultExtraProvisioningAmountCents},
      ${settings.defaultDueDay},
      'active',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  const account = await findBillingAccountById(id)
  if (!account) throw new Error('Nao foi possivel criar conta financeira.')
  return account
}

export async function createBillingAlert(input: {
  billingAccountId?: string | null
  provisioningId?: string | null
  billingRunId?: string | null
  type: string
  severity?: string
  message: string
  details?: unknown
}) {
  const id = createLocalId('billing_alert')
  await prisma.$executeRaw`
    INSERT INTO "BillingAlert" (
      "id",
      "billingAccountId",
      "provisioningId",
      "billingRunId",
      "type",
      "severity",
      "message",
      "details",
      "status",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${input.billingAccountId ?? null},
      ${input.provisioningId ?? null},
      ${input.billingRunId ?? null},
      ${input.type},
      ${input.severity ?? 'warn'},
      ${input.message},
      ${input.details === undefined ? null : serializeDetails(input.details)},
      'open',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  return { id, ...input, status: 'open' }
}

export async function activateBillingServiceForProvisioning(provisioningId: string, activatedAt = new Date()) {
  const provisioning = await prisma.provisioning.findUnique({
    where: { id: provisioningId },
    include: {
      contract: { include: { landlord: true } },
      port: { include: { cto: true } },
    },
  })

  if (!provisioning) {
    throw new Error('Provisionamento nao encontrado para ativacao financeira.')
  }

  const account = await ensureBillingAccountForLandlord(provisioning.contract.landlordId)
  await prisma.$executeRaw`
    UPDATE "BillingAccount"
    SET
      "firstActivationAt" = COALESCE("firstActivationAt", ${activatedAt}),
      "billingStartedAt" = COALESCE("billingStartedAt", ${activatedAt}),
      "status" = CASE WHEN "status" = 'inactive' THEN 'active' ELSE "status" END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${account.id}
  `

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "BillingService" WHERE "provisioningId" = ${provisioning.id} LIMIT 1
  `

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "BillingService"
      SET
        "billingAccountId" = ${account.id},
        "contractId" = ${provisioning.contractId},
        "portId" = ${provisioning.portId},
        "ctoId" = ${provisioning.port.ctoId},
        "serial" = ${provisioning.serial},
        "canceledAt" = NULL,
        "status" = 'active',
        "billingPlanId" = ${account.billingPlanId},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing[0].id}
    `

    return existing[0]
  }

  const id = createLocalId('billing_service')
  await prisma.$executeRaw`
    INSERT INTO "BillingService" (
      "id",
      "billingAccountId",
      "provisioningId",
      "contractId",
      "portId",
      "ctoId",
      "serial",
      "activatedAt",
      "status",
      "billingPlanId",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${account.id},
      ${provisioning.id},
      ${provisioning.contractId},
      ${provisioning.portId},
      ${provisioning.port.ctoId},
      ${provisioning.serial},
      ${activatedAt},
      'active',
      ${account.billingPlanId},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  return { id }
}

export async function cancelBillingServiceForProvisioning(provisioningId: string, canceledAt = new Date()) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "BillingService" WHERE "provisioningId" = ${provisioningId} LIMIT 1
  `
  const service = rows[0]
  if (!service) return null

  await prisma.$executeRaw`
    UPDATE "BillingService"
    SET
      "canceledAt" = ${canceledAt},
      "status" = 'canceled',
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${service.id}
  `

  return service
}

export async function ensureBillingAccountsForLandlords() {
  const landlords = await prisma.landlord.findMany({
    where: {
      user: {
        role: { not: 'admin' },
      },
    },
    select: { id: true },
  })
  const accounts = []

  for (const landlord of landlords) {
    accounts.push(await ensureBillingAccountForLandlord(landlord.id))
  }

  return accounts
}

export async function getOrCreateBillingCycle(input?: {
  year?: number
  month?: number
  closingDay?: number
}) {
  const now = new Date()
  const year = input?.year ?? now.getFullYear()
  const month = input?.month ?? now.getMonth() + 1
  const settings = await getBillingSettings()
  const safeClosingDay = normalizeDay(input?.closingDay, settings.closingDay)
  const competence = monthCompetence(year, month)
  const existing = await findBillingCycleByCompetence(competence)

  if (existing) {
    await prisma.$executeRaw`
      UPDATE "BillingCycle"
      SET "closingAt" = ${closingAt(year, month, safeClosingDay)}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing.id}
    `

    return { ...existing, closingAt: closingAt(year, month, safeClosingDay) }
  }

  const id = createLocalId('billing_cycle')
  const cycle = {
    id,
    year,
    month,
    competence,
    periodStart: periodStart(year, month),
    periodEnd: periodEnd(year, month),
    closingAt: closingAt(year, month, safeClosingDay),
    status: 'open',
  }

  await prisma.$executeRaw`
    INSERT INTO "BillingCycle" (
      "id",
      "year",
      "month",
      "competence",
      "periodStart",
      "periodEnd",
      "closingAt",
      "status",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${cycle.id},
      ${cycle.year},
      ${cycle.month},
      ${cycle.competence},
      ${cycle.periodStart},
      ${cycle.periodEnd},
      ${cycle.closingAt},
      ${cycle.status},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  return cycle
}

async function servicesForRun(accountId: string, closingDate: Date | string) {
  return prisma.$queryRaw<BillingServiceRow[]>`
    SELECT
      "BillingService".*,
      "Contract"."contractNumber"
    FROM "BillingService"
    INNER JOIN "Contract" ON "Contract"."id" = "BillingService"."contractId"
    WHERE "BillingService"."billingAccountId" = ${accountId}
      AND "BillingService"."status" != 'ignored'
      AND "BillingService"."activatedAt" <= ${closingDate}
      AND (
        "BillingService"."canceledAt" IS NULL
        OR "BillingService"."canceledAt" > ${closingDate}
      )
    ORDER BY "BillingService"."activatedAt" ASC, "BillingService"."createdAt" ASC
  `
}

async function approvedPenalties(accountId: string, closingDate: Date | string) {
  return prisma.$queryRaw<BillingPenaltyRow[]>`
    SELECT "id", "amountCents", "reason"
    FROM "BillingPenalty"
    WHERE "billingAccountId" = ${accountId}
      AND "status" = 'approved'
      AND "includedInBillingRunId" IS NULL
      AND "approvedAt" <= ${closingDate}
    ORDER BY "createdAt" ASC
  `
}

async function calculateAccountRun(account: BillingAccountRow, cycle: BillingCycleRow) {
  const existingRun = await findBillingRunByAccountCompetence(account.id, cycle.competence)
  if (existingRun) return existingRun

  const services = await servicesForRun(account.id, cycle.closingAt)
  if (services.length === 0) return null

  const penalties = await approvedPenalties(account.id, cycle.closingAt)
  const activeProvisioningCount = services.length
  const includedProvisioningCount = Math.min(activeProvisioningCount, account.includedProvisionings)
  const extraProvisioningCount = Math.max(0, activeProvisioningCount - account.includedProvisionings)
  const minimumAmountCents = account.minimumAmountCents
  const extraAmountCents = extraProvisioningCount * account.extraProvisioningAmountCents
  const penaltyAmountCents = penalties.reduce((sum, penalty) => sum + penalty.amountCents, 0)
  const totalAmountCents = minimumAmountCents + extraAmountCents + penaltyAmountCents
  const idempotencyKey = `FIREPORT-BILLING-${account.id}-${cycle.competence}`
  const status = !account.hubsoftClientServiceId
    ? 'failed'
    : totalAmountCents > 0
      ? 'ready'
      : 'calculated'
  const runId = createLocalId('billing_run')

  await prisma.$executeRaw`
    INSERT INTO "BillingRun" (
      "id",
      "billingCycleId",
      "billingAccountId",
      "competence",
      "hubsoftClientServiceId",
      "dueDay",
      "activeProvisioningCount",
      "includedProvisioningCount",
      "extraProvisioningCount",
      "minimumAmountCents",
      "extraAmountCents",
      "penaltyAmountCents",
      "totalAmountCents",
      "status",
      "idempotencyKey",
      "calculatedAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${runId},
      ${cycle.id},
      ${account.id},
      ${cycle.competence},
      ${account.hubsoftClientServiceId},
      ${account.dueDay},
      ${activeProvisioningCount},
      ${includedProvisioningCount},
      ${extraProvisioningCount},
      ${minimumAmountCents},
      ${extraAmountCents},
      ${penaltyAmountCents},
      ${totalAmountCents},
      ${status},
      ${idempotencyKey},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  for (const [index, service] of services.entries()) {
    const isIncluded = index < includedProvisioningCount
    const itemId = createLocalId('billing_item')
    await prisma.$executeRaw`
      INSERT INTO "BillingRunItem" (
        "id",
        "billingRunId",
        "billingServiceId",
        "provisioningId",
        "contractId",
        "ctoId",
        "portId",
        "serial",
        "itemType",
        "description",
        "amountCents",
        "isIncludedInMinimum",
        "activatedAt",
        "canceledAt",
        "createdAt"
      ) VALUES (
        ${itemId},
        ${runId},
        ${service.id},
        ${service.provisioningId},
        ${service.contractId},
        ${service.ctoId},
        ${service.portId},
        ${service.serial},
        ${isIncluded ? 'minimum_included' : 'extra_provisioning'},
        ${isIncluded
          ? `Provisionamento incluso na franquia minima - ${service.contractNumber}`
          : `Provisionamento excedente - ${service.contractNumber}`},
        ${isIncluded ? 0 : account.extraProvisioningAmountCents},
        ${isIncluded},
        ${service.activatedAt},
        ${service.canceledAt},
        CURRENT_TIMESTAMP
      )
    `
  }

  for (const penalty of penalties) {
    const itemId = createLocalId('billing_penalty_item')
    await prisma.$executeRaw`
      INSERT INTO "BillingRunItem" (
        "id",
        "billingRunId",
        "itemType",
        "description",
        "amountCents",
        "isIncludedInMinimum",
        "createdAt"
      ) VALUES (
        ${itemId},
        ${runId},
        'penalty',
        ${`Multa - ${penalty.reason}`},
        ${penalty.amountCents},
        false,
        CURRENT_TIMESTAMP
      )
    `
    await prisma.$executeRaw`
      UPDATE "BillingPenalty"
      SET
        "status" = 'included',
        "includedInBillingRunId" = ${runId},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${penalty.id}
    `
  }

  const run = await findBillingRunByAccountCompetence(account.id, cycle.competence)
  if (!run) throw new Error('Fechamento financeiro nao encontrado apos calculo.')

  if (!account.hubsoftClientServiceId) {
    await createBillingAlert({
      billingAccountId: account.id,
      billingRunId: run.id,
      type: 'missing_hubsoft_client_service_id',
      severity: 'error',
      message: 'Conta financeira sem id_cliente_servico Hubsoft. Envio bloqueado.',
      details: { competence: cycle.competence, landlordId: account.landlordId },
    })
  }

  if (totalAmountCents <= 0) {
    await createBillingAlert({
      billingAccountId: account.id,
      billingRunId: run.id,
      type: 'zero_amount_blocked',
      severity: 'warn',
      message: 'Fechamento com valor zero nao sera enviado ao Hubsoft.',
      details: { competence: cycle.competence, activeProvisioningCount },
    })
  }

  return run
}

export async function generateBillingRuns(input?: {
  year?: number
  month?: number
  closingDay?: number
}) {
  await ensureBillingAccountsForLandlords()
  const cycle = await getOrCreateBillingCycle(input)
  const accounts = await prisma.$queryRaw<BillingAccountRow[]>`
    SELECT "BillingAccount".*
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "BillingAccount"."status" = 'active'
      AND "User"."role" <> 'admin'
    ORDER BY "BillingAccount"."createdAt" ASC
  `

  const runs = []
  for (const account of accounts) {
    const run = await calculateAccountRun(account, cycle)
    if (run) runs.push(run)
  }

  return { cycle, runs }
}

export async function createPenalty(input: {
  billingAccountId: string
  amountCents: unknown
  reason: unknown
  evidence?: unknown
  userId?: string | null
}) {
  const amountCents = normalizeNonNegativeInteger(input.amountCents, 0)
  const reason = normalizeOptionalText(input.reason, null, 500)
  const evidence = normalizeOptionalText(input.evidence, null, 2000)
  if (amountCents <= 0) throw new Error('O valor da multa deve ser maior que zero.')
  if (!reason) throw new Error('Informe o motivo da multa.')

  const id = createLocalId('billing_penalty')
  await prisma.$executeRaw`
    INSERT INTO "BillingPenalty" (
      "id",
      "billingAccountId",
      "amountCents",
      "reason",
      "evidence",
      "status",
      "createdByUserId",
      "approvedByUserId",
      "approvedAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${input.billingAccountId},
      ${amountCents},
      ${reason},
      ${evidence},
      'approved',
      ${input.userId ?? null},
      ${input.userId ?? null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `

  return { id, billingAccountId: input.billingAccountId, amountCents, reason, evidence, status: 'approved' }
}

export async function updateBillingAccount(id: string, input: Record<string, unknown>) {
  const current = await findBillingAccountById(id)
  if (!current) return null

  const hubsoftClientServiceId = normalizeOptionalText(
    input.hubsoftClientServiceId,
    current.hubsoftClientServiceId,
    80,
  )
  const minimumAmountCents = normalizeNonNegativeInteger(input.minimumAmountCents, current.minimumAmountCents)
  const includedProvisionings = normalizeNonNegativeInteger(input.includedProvisionings, current.includedProvisionings)
  const extraProvisioningAmountCents = normalizeNonNegativeInteger(
    input.extraProvisioningAmountCents,
    current.extraProvisioningAmountCents,
  )
  const dueDay = normalizeDay(input.dueDay, current.dueDay)
  const status = input.status === 'inactive' || input.status === 'suspended' ? String(input.status) : 'active'
  const notes = normalizeOptionalText(input.notes, current.notes, 1000)

  await prisma.$executeRaw`
    UPDATE "BillingAccount"
    SET
      "hubsoftClientServiceId" = ${hubsoftClientServiceId},
      "minimumAmountCents" = ${minimumAmountCents},
      "includedProvisionings" = ${includedProvisionings},
      "extraProvisioningAmountCents" = ${extraProvisioningAmountCents},
      "dueDay" = ${dueDay},
      "status" = ${status},
      "notes" = ${notes},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `

  return findBillingAccountById(id)
}

export async function listBillingAccounts() {
  await ensureBillingAccountsForLandlords()

  const rows = await prisma.$queryRaw`
    SELECT
      "BillingAccount".*,
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      (
        SELECT COUNT(*) FROM "BillingService"
        WHERE "BillingService"."billingAccountId" = "BillingAccount"."id"
      ) AS "serviceCount",
      (
        SELECT COUNT(*) FROM "BillingRun"
        WHERE "BillingRun"."billingAccountId" = "BillingAccount"."id"
      ) AS "runCount",
      (
        SELECT COUNT(*) FROM "BillingAlert"
        WHERE "BillingAlert"."billingAccountId" = "BillingAccount"."id"
          AND "BillingAlert"."status" = 'open'
      ) AS "openAlertCount"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "User"."role" <> 'admin'
    ORDER BY "BillingAccount"."createdAt" ASC
  `

  return normalizeJsonRows(rows)
}

export async function listBillingRuns() {
  const rows = await prisma.$queryRaw`
    SELECT
      "BillingRun".*,
      "BillingCycle"."closingAt",
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "HubsoftBillingEvent"."status" AS "hubsoftEventStatus",
      (
        SELECT COUNT(*) FROM "BillingRunItem"
        WHERE "BillingRunItem"."billingRunId" = "BillingRun"."id"
      ) AS "itemCount",
      (
        SELECT COUNT(*) FROM "BillingAlert"
        WHERE "BillingAlert"."billingRunId" = "BillingRun"."id"
          AND "BillingAlert"."status" = 'open'
      ) AS "openAlertCount"
    FROM "BillingRun"
    INNER JOIN "BillingCycle" ON "BillingCycle"."id" = "BillingRun"."billingCycleId"
    INNER JOIN "BillingAccount" ON "BillingAccount"."id" = "BillingRun"."billingAccountId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    LEFT JOIN "HubsoftBillingEvent" ON "HubsoftBillingEvent"."billingRunId" = "BillingRun"."id"
    WHERE "User"."role" <> 'admin'
    ORDER BY "BillingRun"."competence" DESC, "BillingRun"."createdAt" DESC
  `

  return normalizeJsonRows(rows)
}

export async function listBillingPenalties() {
  const rows = await prisma.$queryRaw`
    SELECT
      "BillingPenalty".*,
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "BillingRun"."competence" AS "includedCompetence"
    FROM "BillingPenalty"
    INNER JOIN "BillingAccount" ON "BillingAccount"."id" = "BillingPenalty"."billingAccountId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    LEFT JOIN "BillingRun" ON "BillingRun"."id" = "BillingPenalty"."includedInBillingRunId"
    WHERE "User"."role" <> 'admin'
    ORDER BY "BillingPenalty"."createdAt" DESC
  `

  return normalizeJsonRows(rows)
}

export async function listBillingAlerts() {
  const rows = await prisma.$queryRaw`
    SELECT
      "BillingAlert".*,
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "BillingRun"."competence",
      "Provisioning"."serial" AS "provisioningSerial",
      "Provisioning"."status" AS "provisioningStatus"
    FROM "BillingAlert"
    LEFT JOIN "BillingAccount" ON "BillingAccount"."id" = "BillingAlert"."billingAccountId"
    LEFT JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    LEFT JOIN "User" ON "User"."id" = "Landlord"."userId"
    LEFT JOIN "BillingRun" ON "BillingRun"."id" = "BillingAlert"."billingRunId"
    LEFT JOIN "Provisioning" ON "Provisioning"."id" = "BillingAlert"."provisioningId"
    WHERE "User"."role" IS NULL OR "User"."role" <> 'admin'
    ORDER BY "BillingAlert"."status" ASC, "BillingAlert"."createdAt" DESC
  `

  return normalizeJsonRows(rows)
}

export async function listBillingInvoices() {
  const rows = await prisma.$queryRaw`
    SELECT
      "HubsoftInvoiceSnapshot".*,
      "Landlord"."name" AS "landlordName",
      "User"."id" AS "userId",
      "User"."name" AS "userName",
      "User"."email" AS "userEmail"
    FROM "HubsoftInvoiceSnapshot"
    INNER JOIN "BillingAccount" ON "BillingAccount"."id" = "HubsoftInvoiceSnapshot"."billingAccountId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "User"."role" <> 'admin'
    ORDER BY "HubsoftInvoiceSnapshot"."dueDate" DESC, "HubsoftInvoiceSnapshot"."createdAt" DESC
  `

  return normalizeJsonRows(rows)
}

export async function listOperatorBillingInvoices(userId: string) {
  const rows = await prisma.$queryRaw`
    SELECT
      "HubsoftInvoiceSnapshot".*
    FROM "HubsoftInvoiceSnapshot"
    INNER JOIN "BillingAccount" ON "BillingAccount"."id" = "HubsoftInvoiceSnapshot"."billingAccountId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    WHERE "Landlord"."userId" = ${userId}
    ORDER BY "HubsoftInvoiceSnapshot"."dueDate" DESC, "HubsoftInvoiceSnapshot"."createdAt" DESC
  `

  return normalizeJsonRows(rows)
}

async function findBillingAccountByUserId(userId: string) {
  const rows = await prisma.$queryRaw<BillingInvoiceAccountRow[]>`
    SELECT
      "BillingAccount"."id",
      "BillingAccount"."hubsoftClientServiceId",
      "Landlord"."document" AS "document",
      "Landlord"."hubsoftClientId" AS "hubsoftClientId"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    WHERE "Landlord"."userId" = ${userId}
    LIMIT 1
  `

  return rows[0] ?? null
}

async function findBillingInvoiceAccountById(accountId: string) {
  const rows = await prisma.$queryRaw<BillingInvoiceAccountRow[]>`
    SELECT
      "BillingAccount"."id",
      "BillingAccount"."hubsoftClientServiceId",
      "Landlord"."document" AS "document",
      "Landlord"."hubsoftClientId" AS "hubsoftClientId"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    WHERE "BillingAccount"."id" = ${accountId}
    LIMIT 1
  `

  return rows[0] ?? null
}

async function fetchHubsoftInvoicesForBillingAccount(account: BillingInvoiceAccountRow) {
  if (account.document) {
    return fetchHubsoftInvoicesByCnpj(account.document)
  }

  if (account.hubsoftClientId) {
    return fetchHubsoftInvoicesByClientId(account.hubsoftClientId)
  }

  if (account.hubsoftClientServiceId) {
    return fetchHubsoftInvoicesByClientServiceId(account.hubsoftClientServiceId)
  }

  throw new Error('Conta financeira sem CNPJ, id_cliente ou id_cliente_servico Hubsoft.')
}

async function saveHubsoftInvoiceSnapshots(account: BillingInvoiceAccountRow, invoices: HubsoftInvoice[]) {
  await prisma.$executeRaw`
    DELETE FROM "HubsoftInvoiceSnapshot"
    WHERE "billingAccountId" = ${account.id}
  `

  for (const invoice of invoices) {
    const id = createLocalId('hubsoft_invoice')
    await prisma.$executeRaw`
      INSERT INTO "HubsoftInvoiceSnapshot" (
        "id",
        "billingAccountId",
        "hubsoftInvoiceId",
        "hubsoftClientServiceId",
        "competence",
        "dueDate",
        "amountCents",
        "status",
        "rawPayload",
        "syncedAt",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${account.id},
        ${invoice.idFatura},
        ${invoice.idClienteServico || account.hubsoftClientServiceId},
        ${invoiceCompetence(invoice)},
        ${parseHubsoftDate(invoice.dueDate)},
        ${moneyToCents(invoice.amount)},
        ${invoice.status},
        ${serializeDetails(invoice.raw)},
        ${new Date()},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `
  }

  return invoices.length
}

export async function syncHubsoftInvoicesForBillingAccount(accountId: string) {
  const account = await findBillingInvoiceAccountById(accountId)
  if (!account) throw new Error('Conta financeira nao encontrada.')

  const invoices = await fetchHubsoftInvoicesForBillingAccount(account)
  const synced = await saveHubsoftInvoiceSnapshots(account, invoices)
  return { billingAccountId: account.id, synced }
}

export async function syncHubsoftInvoicesForOperator(userId: string) {
  const account = await findBillingAccountByUserId(userId)
  if (!account) throw new Error('Conta financeira nao encontrada para o operador.')

  const invoices = await fetchHubsoftInvoicesForBillingAccount(account)
  const synced = await saveHubsoftInvoiceSnapshots(account, invoices)
  return { billingAccountId: account.id, synced }
}

export async function syncAllHubsoftInvoices() {
  const accounts = await prisma.$queryRaw<BillingInvoiceAccountRow[]>`
    SELECT
      "BillingAccount"."id",
      "BillingAccount"."hubsoftClientServiceId",
      "Landlord"."document" AS "document",
      "Landlord"."hubsoftClientId" AS "hubsoftClientId"
    FROM "BillingAccount"
    INNER JOIN "Landlord" ON "Landlord"."id" = "BillingAccount"."landlordId"
    INNER JOIN "User" ON "User"."id" = "Landlord"."userId"
    WHERE "User"."role" <> 'admin'
      AND (
        "Landlord"."document" IS NOT NULL
        OR "Landlord"."hubsoftClientId" IS NOT NULL
        OR "BillingAccount"."hubsoftClientServiceId" IS NOT NULL
      )
    ORDER BY "BillingAccount"."createdAt" ASC
  `
  const result = { accounts: 0, invoices: 0, errors: 0 }

  for (const account of accounts) {
    try {
      const invoices = await fetchHubsoftInvoicesForBillingAccount(account)
      result.invoices += await saveHubsoftInvoiceSnapshots(account, invoices)
      result.accounts += 1
    } catch (error) {
      result.errors += 1
      await createBillingAlert({
        billingAccountId: account.id,
        type: 'hubsoft_invoice_sync_failed',
        severity: 'warn',
        message: 'Falha ao sincronizar faturas do Hubsoft.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  return result
}

export async function resolveBillingAlert(id: string, userId: string) {
  await prisma.$executeRaw`
    UPDATE "BillingAlert"
    SET
      "status" = 'resolved',
      "resolvedByUserId" = ${userId},
      "resolvedAt" = ${new Date()},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
  const rows = await prisma.$queryRaw`
    SELECT * FROM "BillingAlert" WHERE "id" = ${id} LIMIT 1
  `

  return Array.isArray(rows) ? normalizeJsonRows(rows[0] ?? null) : null
}

export async function markBillingRunAsSent(runId: string, responsePayload?: unknown) {
  const rows = await prisma.$queryRaw<BillingRunRow[]>`
    SELECT * FROM "BillingRun" WHERE "id" = ${runId} LIMIT 1
  `
  const run = rows[0]
  if (!run) throw new Error('Fechamento nao encontrado.')
  if (!run.hubsoftClientServiceId) throw new Error('Fechamento sem id_cliente_servico Hubsoft.')
  if (run.totalAmountCents <= 0) throw new Error('Fechamento com valor zero nao deve ser enviado ao Hubsoft.')

  const eventId = createLocalId('hubsoft_billing_event')
  const description = buildRunDescription(run)
  const payload = {
    id_cliente_servico: run.hubsoftClientServiceId,
    servico: HUBSOFT_SERVICE_NAME,
    valor_centavos: run.totalAmountCents,
    competencia: run.competence,
    referencia: run.idempotencyKey,
    descricao: description,
  }

  await prisma.$executeRaw`
    INSERT INTO "HubsoftBillingEvent" (
      "id",
      "billingRunId",
      "hubsoftClientServiceId",
      "hubsoftEventType",
      "idempotencyKey",
      "amountCents",
      "description",
      "requestPayload",
      "responsePayload",
      "status",
      "attempts",
      "sentAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${eventId},
      ${run.id},
      ${run.hubsoftClientServiceId},
      ${HUBSOFT_SERVICE_NAME},
      ${run.idempotencyKey},
      ${run.totalAmountCents},
      ${description},
      ${serializeDetails(payload)},
      ${responsePayload === undefined ? null : serializeDetails(responsePayload)},
      'sent',
      1,
      ${new Date()},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT("billingRunId") DO UPDATE SET
      "responsePayload" = excluded."responsePayload",
      "status" = 'sent',
      "attempts" = "HubsoftBillingEvent"."attempts" + 1,
      "sentAt" = excluded."sentAt",
      "updatedAt" = CURRENT_TIMESTAMP
  `
  await prisma.$executeRaw`
    UPDATE "BillingRun"
    SET "status" = 'sent', "sentAt" = ${new Date()}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${run.id}
  `

  return { id: eventId, billingRunId: run.id, status: 'sent' }
}
