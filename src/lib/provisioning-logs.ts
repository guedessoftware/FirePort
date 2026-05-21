import { prisma } from './prisma'

type ProvisioningLogLevel = 'info' | 'success' | 'warn' | 'error'

const essentialProvisioningStages = new Set([
  'provisioning.created',
  'provisioning.reassigned',
  'provisioning.reused',
  'port.reserved',
  'port.reserve_failed',
  'olt.registration_started',
  'olt.registration_finished',
  'olt.registration.success',
  'olt.retry_started',
  'olt.retry_finished',
  'olt.retry_skipped',
  'olt.pon.position_configured',
  'olt.pon.position_selected',
  'olt.authorization.success',
  'olt.authorization.skipped',
  'olt.provisioning.success',
  'olt.deprovision.requested',
  'olt.deprovision.finished',
  'olt.deprovision.success',
  'hubsoft.port.reserve_finished',
  'hubsoft.port.rollback_started',
  'hubsoft.port.rollback_local_finished',
  'billing.service.activated',
  'billing.service.canceled',
  'import.csv.created',
  'import.csv.onu_lookup_matched',
])

const noisyStageFragments = [
  '.lookup_',
  '_lookup_',
  '.precheck',
  '.context.',
  'context_loaded',
  '.commands.rendered',
  '.commands_rendered',
  '.rendered',
  '.refresh_started',
  '.refresh_finished',
  'onu_lookup',
  'serial_lookup',
  'position_lookup',
  'pon_query',
  'snmp.refresh',
]

function isFailureLikeStage(stage: string) {
  return /(^|[._])(failed|failure|blocked|missing|unrecognized|unavailable|occupied|empty|cli_error|validation_failed|cancel_failed|activation_failed)([._]|$)/.test(stage)
}

function isNoisyStage(stage: string) {
  return noisyStageFragments.some((fragment) => stage.includes(fragment))
}

function hasLosSignal(input: { stage: string; message: string; details?: unknown }) {
  const details = input.details === undefined
    ? ''
    : typeof input.details === 'string'
      ? input.details
      : serializeDetails(input.details) ?? ''
  const text = `${input.stage} ${input.message} ${details}`.toLowerCase()

  return /(^|[^a-z0-9])los([^a-z0-9]|$)|loss of signal|sem sinal/.test(text)
}

export function shouldPersistProvisioningLog(input: {
  level?: ProvisioningLogLevel
  stage: string
  message: string
  details?: unknown
}) {
  if (process.env.PROVISIONING_LOG_VERBOSE === 'true') {
    return true
  }

  const level = input.level ?? 'info'
  const stage = input.stage.toLowerCase()

  if (hasLosSignal(input)) {
    return true
  }

  if (level === 'error') {
    return true
  }

  if (essentialProvisioningStages.has(stage)) {
    return true
  }

  if (level === 'warn') {
    return isFailureLikeStage(stage) && !isNoisyStage(stage)
  }

  return false
}

function serializeDetails(details?: unknown) {
  if (!details) {
    return null
  }

  try {
    return JSON.stringify(details)
  } catch {
    return JSON.stringify({ serializationError: 'Nao foi possivel serializar os detalhes do evento.' })
  }
}

export async function addProvisioningLog(input: {
  provisioningId: string
  level?: ProvisioningLogLevel
  stage: string
  message: string
  details?: Record<string, unknown>
}) {
  if (!shouldPersistProvisioningLog(input)) {
    return
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO ProvisioningLog (
        id,
        provisioningId,
        level,
        stage,
        message,
        details
      ) VALUES (
        lower(hex(randomblob(16))),
        ${input.provisioningId},
        ${input.level ?? 'info'},
        ${input.stage},
        ${input.message},
        ${serializeDetails(input.details)}
      )
    `
  } catch (error) {
    console.error('[PROVISIONING LOG] falha ao registrar evento', {
      provisioningId: input.provisioningId,
      stage: input.stage,
      error,
    })
  }
}

export async function cleanupNoisyProvisioningLogs() {
  try {
    await prisma.$executeRaw`
      DELETE FROM ProvisioningLog
      WHERE
        lower(level) <> 'error'
        AND lower(COALESCE(stage, '') || ' ' || COALESCE(message, '') || ' ' || COALESCE(details, '')) NOT LIKE '% los %'
        AND lower(COALESCE(stage, '') || ' ' || COALESCE(message, '') || ' ' || COALESCE(details, '')) NOT LIKE '%"los"%'
        AND lower(stage) NOT IN (
          'provisioning.created',
          'provisioning.reassigned',
          'provisioning.reused',
          'port.reserved',
          'port.reserve_failed',
          'olt.registration_started',
          'olt.registration_finished',
          'olt.registration.success',
          'olt.retry_started',
          'olt.retry_finished',
          'olt.retry_skipped',
          'olt.pon.position_configured',
          'olt.pon.position_selected',
          'olt.authorization.success',
          'olt.authorization.skipped',
          'olt.provisioning.success',
          'olt.deprovision.requested',
          'olt.deprovision.finished',
          'olt.deprovision.success',
          'hubsoft.port.reserve_finished',
          'hubsoft.port.rollback_started',
          'hubsoft.port.rollback_local_finished',
          'billing.service.activated',
          'billing.service.canceled',
          'import.csv.created',
          'import.csv.onu_lookup_matched'
        )
        AND NOT (
          lower(level) = 'warn'
          AND (
            lower(stage) LIKE '%failed%'
            OR lower(stage) LIKE '%failure%'
            OR lower(stage) LIKE '%blocked%'
            OR lower(stage) LIKE '%missing%'
            OR lower(stage) LIKE '%unavailable%'
            OR lower(stage) LIKE '%occupied%'
            OR lower(stage) LIKE '%empty%'
            OR lower(stage) LIKE '%validation_failed%'
            OR lower(stage) LIKE '%cancel_failed%'
            OR lower(stage) LIKE '%activation_failed%'
          )
          AND lower(stage) NOT LIKE '%lookup%'
          AND lower(stage) NOT LIKE '%precheck%'
          AND lower(stage) NOT LIKE '%refresh%'
          AND lower(stage) NOT LIKE '%pon_query%'
          AND lower(stage) NOT LIKE '%snmp%'
        )
    `
  } catch (error) {
    console.error('[PROVISIONING LOG] falha ao limpar eventos ruidosos', error)
  }
}

export function parseProvisioningLogDetails(details?: string | null) {
  if (!details) {
    return null
  }

  try {
    return JSON.parse(details) as Record<string, unknown>
  } catch {
    return { raw: details }
  }
}
