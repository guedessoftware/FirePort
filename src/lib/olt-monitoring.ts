import { getOltMonitoringSettings, saveOltMonitoringRunResult } from './app-settings'
import {
  collectOltMetricsViaSnmp,
  deleteOldOltHealthHistory,
  listSnmpEnabledOltMetricDevices,
  saveOltSnapshot,
} from './olt-snmp-monitoring'
import { prisma } from './prisma'

type MonitorResult = {
  activeChecked: number
  success: number
  failed: number
  error: string | null
}

const MONITOR_TICK_MS = 30_000

type OltMonitorState = {
  timer: NodeJS.Timeout | null
  isRunning: boolean
}

const globalForOltMonitor = globalThis as unknown as {
  oltTelemetryMonitorState: OltMonitorState | undefined
}

const oltMonitorState = globalForOltMonitor.oltTelemetryMonitorState ??= {
  timer: null,
  isRunning: false,
}

export class OltMonitorAlreadyRunningError extends Error {
  constructor() {
    super('Monitoramento de OLT já está em execução.')
    this.name = 'OltMonitorAlreadyRunningError'
  }
}

async function saveOltFailureEvent(oltId: string, error: string) {
  await prisma.$executeRaw`
    INSERT INTO "OnuEvent" ("id", "oltId", "ponIndex", "onuId", "eventType", "previousValue", "currentValue", "createdAt")
    VALUES (lower(hex(randomblob(16))), ${oltId}, 0, 0, 'olt_metrics_snmp_unreachable', NULL, ${error}, CURRENT_TIMESTAMP)
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

function shouldLogOltMonitorDebug() {
  return process.env.OLT_MONITOR_DEBUG === 'true'
}

export async function runOltTelemetryMonitorOnce(): Promise<MonitorResult> {
  const startedAt = new Date()
  let activeChecked = 0
  let success = 0
  let failed = 0
  let error: string | null = null

  try {
    const settings = await getOltMonitoringSettings()
    const oltDevices = await listSnmpEnabledOltMetricDevices()
    activeChecked = oltDevices.length

    for (const oltDevice of oltDevices) {
      try {
        const snapshot = await collectOltMetricsViaSnmp(oltDevice, settings.trafficIntervalSeconds)
        if (snapshot.processors.length === 0 && snapshot.temperatures.length === 0 && snapshot.uplinks.length === 0) {
          throw new Error(`SNMP da OLT ${oltDevice.name} respondeu sem métricas nos OIDs configurados.`)
        }
        await saveOltSnapshot(snapshot)
        success += 1
      } catch (itemError) {
        failed += 1
        const message = (itemError as Error).message
        await saveOltFailureEvent(oltDevice.id, message).catch((eventError) => {
          console.error('[OLT MONITOR] falha ao registrar evento SNMP', eventError)
        })
        console.error('[OLT MONITOR] falha ao coletar OLT via SNMP', {
          oltId: oltDevice.id,
          oltName: oltDevice.name,
          error: itemError,
        })
      }
    }

    await deleteOldOltHealthHistory(Number(process.env.OLT_HISTORY_RETENTION_DAYS || 30))
  } catch (runError) {
    error = (runError as Error).message
    console.error('[OLT MONITOR] falha geral no monitoramento', runError)
  }

  await saveOltMonitoringRunResult({
    startedAt,
    finishedAt: new Date(),
    activeChecked,
    success,
    failed,
    error,
  })

  return { activeChecked, success, failed, error }
}

export async function runOltTelemetryMonitorNow() {
  if (oltMonitorState.isRunning) {
    throw new OltMonitorAlreadyRunningError()
  }

  oltMonitorState.isRunning = true
  try {
    return await runOltTelemetryMonitorOnce()
  } finally {
    oltMonitorState.isRunning = false
  }
}

async function runDueMonitorTick() {
  if (oltMonitorState.isRunning) {
    return
  }

  const settings = await getOltMonitoringSettings()
  if (!settings.enabled || !hasIntervalElapsed(settings.lastFinishedAt, settings.intervalMinutes)) {
    return
  }

  if (shouldLogOltMonitorDebug()) {
    console.log('[OLT MONITOR] iniciando atualizacao automatica', {
      intervalMinutes: settings.intervalMinutes,
      trafficIntervalSeconds: settings.trafficIntervalSeconds,
    })
  }

  const result = await runOltTelemetryMonitorNow()
  if (shouldLogOltMonitorDebug()) {
    console.log('[OLT MONITOR] atualizacao automatica concluida', result)
  }
}

export function startOltTelemetryMonitorJob(options: { runImmediately?: boolean } = {}) {
  if (oltMonitorState.timer) {
    return
  }

  oltMonitorState.timer = setInterval(() => {
    void runDueMonitorTick().catch((error) => {
      oltMonitorState.isRunning = false
      console.error('[OLT MONITOR] tick falhou', error)
    })
  }, MONITOR_TICK_MS)

  if (options.runImmediately ?? true) {
    void runDueMonitorTick().catch((error) => {
      oltMonitorState.isRunning = false
      console.error('[OLT MONITOR] tick inicial falhou', error)
    })
  }

  if (shouldLogOltMonitorDebug()) {
    console.log('[OLT MONITOR] job agendado')
  }
}

export function stopOltTelemetryMonitorJob() {
  if (!oltMonitorState.timer) {
    return
  }

  clearInterval(oltMonitorState.timer)
  oltMonitorState.timer = null
  if (shouldLogOltMonitorDebug()) {
    console.log('[OLT MONITOR] job parado')
  }
}

export async function syncOltTelemetryMonitorJob(options: { runImmediately?: boolean } = {}) {
  const settings = await getOltMonitoringSettings()

  if (settings.enabled) {
    startOltTelemetryMonitorJob(options)
  } else {
    stopOltTelemetryMonitorJob()
  }

  return settings
}
