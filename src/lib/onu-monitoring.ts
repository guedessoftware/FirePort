import { getOnuMonitoringSettings, saveOnuMonitoringRunResult } from './app-settings'
import { prisma } from './prisma'
import {
  collectOltOnusViaSnmp,
  deleteOldOnuHistory,
  listSnmpEnabledOltDevices,
  saveOnuSnapshots,
  syncProvisioningTelemetryFromOnuCurrent,
} from './onu-snmp'

type MonitorResult = {
  activeChecked: number
  success: number
  failed: number
  error: string | null
}

const MONITOR_TICK_MS = 30_000

type OnuMonitorState = {
  timer: NodeJS.Timeout | null
  isRunning: boolean
}

const globalForOnuMonitor = globalThis as unknown as {
  onuTelemetryMonitorState: OnuMonitorState | undefined
}

const onuMonitorState = globalForOnuMonitor.onuTelemetryMonitorState ??= {
  timer: null,
  isRunning: false,
}

export class OnuMonitorAlreadyRunningError extends Error {
  constructor() {
    super('Monitoramento de ONU/CPE já está em execução.')
    this.name = 'OnuMonitorAlreadyRunningError'
  }
}

async function saveOltFailureEvent(oltId: string, error: string) {
  await prisma.$executeRaw`
    INSERT INTO "OnuEvent" ("id", "oltId", "ponIndex", "onuId", "eventType", "previousValue", "currentValue", "createdAt")
    VALUES (lower(hex(randomblob(16))), ${oltId}, 0, 0, 'olt_snmp_unreachable', NULL, ${error}, CURRENT_TIMESTAMP)
  `
}

function hasIntervalElapsed(lastFinishedAt: string | null, intervalMinutes: number) {
  if (!lastFinishedAt) {
    return true
  }

  const lastFinishedTime = new Date(lastFinishedAt).getTime()
  if (!Number.isFinite(lastFinishedTime)) {
    return true
  }

  return Date.now() - lastFinishedTime >= intervalMinutes * 60_000
}

function shouldLogOnuMonitorDebug() {
  return process.env.ONU_MONITOR_DEBUG === 'true'
}

export async function runOnuTelemetryMonitorOnce(): Promise<MonitorResult> {
  const startedAt = new Date()
  let activeChecked = 0
  let success = 0
  let failed = 0
  let error: string | null = null

  try {
    const oltDevices = await listSnmpEnabledOltDevices()
    activeChecked = oltDevices.length

    for (const oltDevice of oltDevices) {
      try {
        const snapshots = await collectOltOnusViaSnmp(oltDevice)
        if (snapshots.length === 0) {
          throw new Error(`SNMP da OLT ${oltDevice.name} respondeu sem ONUs nos OIDs configurados.`)
        }
        await saveOnuSnapshots(snapshots)
        success += snapshots.length
      } catch (itemError) {
        failed += 1
        const message = (itemError as Error).message
        await saveOltFailureEvent(oltDevice.id, message).catch((eventError) => {
          console.error('[ONU MONITOR] falha ao registrar evento SNMP', eventError)
        })
        console.error('[ONU MONITOR] falha ao coletar OLT via SNMP', {
          oltId: oltDevice.id,
          oltName: oltDevice.name,
          error: itemError,
        })
      }
    }

    await syncProvisioningTelemetryFromOnuCurrent()
    await deleteOldOnuHistory(Number(process.env.ONU_HISTORY_RETENTION_DAYS || 30))
  } catch (runError) {
    error = (runError as Error).message
    console.error('[ONU MONITOR] falha geral no monitoramento', runError)
  }

  await saveOnuMonitoringRunResult({
    startedAt,
    finishedAt: new Date(),
    activeChecked,
    success,
    failed,
    error,
  })

  return { activeChecked, success, failed, error }
}

export async function runOnuTelemetryMonitorNow() {
  if (onuMonitorState.isRunning) {
    throw new OnuMonitorAlreadyRunningError()
  }

  onuMonitorState.isRunning = true
  try {
    return await runOnuTelemetryMonitorOnce()
  } finally {
    onuMonitorState.isRunning = false
  }
}

async function runDueMonitorTick() {
  if (onuMonitorState.isRunning) {
    return
  }

  const settings = await getOnuMonitoringSettings()
  if (!settings.enabled || !hasIntervalElapsed(settings.lastFinishedAt, settings.intervalMinutes)) {
    return
  }

  if (shouldLogOnuMonitorDebug()) {
    console.log('[ONU MONITOR] iniciando atualizacao automatica', {
      intervalMinutes: settings.intervalMinutes,
    })
  }

  const result = await runOnuTelemetryMonitorNow()
  if (shouldLogOnuMonitorDebug()) {
    console.log('[ONU MONITOR] atualizacao automatica concluida', result)
  }
}

export function startOnuTelemetryMonitorJob(options: { runImmediately?: boolean } = {}) {
  if (onuMonitorState.timer) {
    return
  }

  onuMonitorState.timer = setInterval(() => {
    void runDueMonitorTick().catch((error) => {
      onuMonitorState.isRunning = false
      console.error('[ONU MONITOR] tick falhou', error)
    })
  }, MONITOR_TICK_MS)

  if (options.runImmediately ?? true) {
    void runDueMonitorTick().catch((error) => {
      onuMonitorState.isRunning = false
      console.error('[ONU MONITOR] tick inicial falhou', error)
    })
  }

  if (shouldLogOnuMonitorDebug()) {
    console.log('[ONU MONITOR] job agendado')
  }
}

export function stopOnuTelemetryMonitorJob() {
  if (!onuMonitorState.timer) {
    return
  }

  clearInterval(onuMonitorState.timer)
  onuMonitorState.timer = null
  if (shouldLogOnuMonitorDebug()) {
    console.log('[ONU MONITOR] job parado')
  }
}

export async function syncOnuTelemetryMonitorJob(options: { runImmediately?: boolean } = {}) {
  const settings = await getOnuMonitoringSettings()

  if (settings.enabled) {
    startOnuTelemetryMonitorJob(options)
  } else {
    stopOnuTelemetryMonitorJob()
  }

  return settings
}
