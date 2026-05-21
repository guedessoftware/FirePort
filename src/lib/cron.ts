import * as cron from 'node-cron'
import {
  generateBillingRuns,
  getBillingSettings,
  saveAutomaticBillingClosingResult,
} from './billing'
import { evaluateAllAccessControls } from './access-control'
import { syncCtosFromHubsoft } from './hubsoft'
import { processNotificationQueue } from './notifications'

let ctoSyncTask: cron.ScheduledTask | null = null
let billingClosingTask: cron.ScheduledTask | null = null
let accessControlDailyTask: cron.ScheduledTask | null = null
let accessControlHubsoftTask: cron.ScheduledTask | null = null
let notificationQueueTask: cron.ScheduledTask | null = null

const globalForBillingClosing = globalThis as unknown as {
  billingAutomaticClosingRunning: boolean | undefined
}
const globalForAccessControl = globalThis as unknown as {
  accessControlDailyRunning: boolean | undefined
  accessControlHubsoftRunning: boolean | undefined
  notificationQueueRunning: boolean | undefined
}

function monthCompetence(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function shouldLogSchedulerDebug() {
  return process.env.SCHEDULER_DEBUG === 'true'
}

export function startCtoSyncJob() {
  if (ctoSyncTask) {
    return
  }

  // Run every hour at minute 0
  ctoSyncTask = cron.schedule('0 * * * *', async () => {
    if (shouldLogSchedulerDebug()) {
      console.log('Starting scheduled CTO sync from Hubsoft...')
    }
    try {
      const result = await syncCtosFromHubsoft()
      if (shouldLogSchedulerDebug()) {
        console.log(`CTO sync completed: ${result.synced} synced, ${result.created} created, ${result.updated} updated, ${result.missingInHubsoft} missing, ${result.errors} errors`)
      }
    } catch (error) {
      console.error('Scheduled CTO sync failed:', error)
    }
  })

  if (shouldLogSchedulerDebug()) {
    console.log('CTO sync job scheduled to run every hour')
  }
}

// For manual testing
export async function runCtoSyncManually() {
  if (shouldLogSchedulerDebug()) {
    console.log('Running manual CTO sync...')
  }
  try {
    const result = await syncCtosFromHubsoft()
    if (shouldLogSchedulerDebug()) {
      console.log(`Manual CTO sync completed: ${result.synced} synced, ${result.created} created, ${result.updated} updated, ${result.missingInHubsoft} missing, ${result.errors} errors`)
    }
    return result
  } catch (error) {
    console.error('Manual CTO sync failed:', error)
    throw error
  }
}

async function runAutomaticBillingClosingTick() {
  if (globalForBillingClosing.billingAutomaticClosingRunning) {
    return
  }

  const settings = await getBillingSettings()
  if (!settings.automaticClosingEnabled) {
    return
  }

  const now = new Date()
  const competence = monthCompetence(now)
  if (now.getDate() !== settings.closingDay) {
    return
  }

  if (
    settings.lastAutomaticClosingCompetence === competence &&
    !settings.lastAutomaticClosingError
  ) {
    return
  }

  globalForBillingClosing.billingAutomaticClosingRunning = true
  if (shouldLogSchedulerDebug()) {
    console.log('[BILLING] iniciando fechamento automatico', {
      competence,
      closingDay: settings.closingDay,
    })
  }

  try {
    const result = await generateBillingRuns({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      closingDay: settings.closingDay,
    })
    await saveAutomaticBillingClosingResult({ competence, closedAt: now })
    if (shouldLogSchedulerDebug()) {
      console.log('[BILLING] fechamento automatico concluido', {
        competence: result.cycle.competence,
        runs: result.runs.length,
      })
    }
  } catch (error) {
    await saveAutomaticBillingClosingResult({ competence, closedAt: now, error })
    console.error('[BILLING] fechamento automatico falhou', error)
  } finally {
    globalForBillingClosing.billingAutomaticClosingRunning = false
  }
}

export function startBillingAutomaticClosingJob() {
  if (billingClosingTask) {
    return
  }

  billingClosingTask = cron.schedule('10 * * * *', () => {
    void runAutomaticBillingClosingTick().catch((error) => {
      globalForBillingClosing.billingAutomaticClosingRunning = false
      console.error('[BILLING] tick de fechamento automatico falhou', error)
    })
  })

  void runAutomaticBillingClosingTick().catch((error) => {
    globalForBillingClosing.billingAutomaticClosingRunning = false
    console.error('[BILLING] tick inicial de fechamento automatico falhou', error)
  })

  if (shouldLogSchedulerDebug()) {
    console.log('[BILLING] fechamento automatico agendado')
  }
}

async function runDailyAccessControlTick() {
  if (globalForAccessControl.accessControlDailyRunning) return
  globalForAccessControl.accessControlDailyRunning = true

  try {
    const result = await evaluateAllAccessControls({
      origin: 'automatic',
      sendNotifications: true,
      syncHubsoft: true,
    })
    if (shouldLogSchedulerDebug()) {
      console.log('[ACCESS CONTROL] regua diaria concluida', result)
    }
  } catch (error) {
    console.error('[ACCESS CONTROL] regua diaria falhou', error)
  } finally {
    globalForAccessControl.accessControlDailyRunning = false
  }
}

async function runHubsoftAccessControlTick() {
  if (globalForAccessControl.accessControlHubsoftRunning) return
  globalForAccessControl.accessControlHubsoftRunning = true

  try {
    const result = await evaluateAllAccessControls({
      origin: 'automatic',
      sendNotifications: false,
      syncHubsoft: true,
    })
    if (shouldLogSchedulerDebug()) {
      console.log('[ACCESS CONTROL] verificacao Hubsoft concluida', result)
    }
  } catch (error) {
    console.error('[ACCESS CONTROL] verificacao Hubsoft falhou', error)
  } finally {
    globalForAccessControl.accessControlHubsoftRunning = false
  }
}

export function startAccessControlJobs() {
  if (!accessControlDailyTask) {
    accessControlDailyTask = cron.schedule('0 8 * * 1-5', () => {
      void runDailyAccessControlTick()
    })
    if (shouldLogSchedulerDebug()) {
      console.log('[ACCESS CONTROL] regua diaria agendada para dias uteis as 08:00')
    }
  }

  if (!accessControlHubsoftTask) {
    accessControlHubsoftTask = cron.schedule('*/15 * * * *', () => {
      void runHubsoftAccessControlTick()
    })
    if (shouldLogSchedulerDebug()) {
      console.log('[ACCESS CONTROL] verificacao Hubsoft agendada a cada 15 minutos')
    }
  }
}

async function runNotificationQueueTick() {
  if (globalForAccessControl.notificationQueueRunning) return
  globalForAccessControl.notificationQueueRunning = true

  try {
    const result = await processNotificationQueue()
    if (result.processed > 0 && shouldLogSchedulerDebug()) {
      console.log('[NOTIFICATIONS] fila processada', result)
    }
  } catch (error) {
    console.error('[NOTIFICATIONS] processamento da fila falhou', error)
  } finally {
    globalForAccessControl.notificationQueueRunning = false
  }
}

export function startNotificationQueueJob() {
  if (notificationQueueTask) {
    return
  }

  notificationQueueTask = cron.schedule('*/2 * * * *', () => {
    void runNotificationQueueTick()
  })

  if (shouldLogSchedulerDebug()) {
    console.log('[NOTIFICATIONS] fila agendada a cada 2 minutos')
  }
}

export async function runAccessControlManually(input: {
  sendNotifications?: boolean
  syncHubsoft?: boolean
  userId?: string | null
} = {}) {
  return evaluateAllAccessControls({
    origin: 'manual',
    sendNotifications: input.sendNotifications,
    syncHubsoft: input.syncHubsoft,
    userId: input.userId,
  })
}

export async function runNotificationQueueManually() {
  return processNotificationQueue()
}
