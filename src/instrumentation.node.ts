import { startAccessControlJobs, startBillingAutomaticClosingJob, startCtoSyncJob, startNotificationQueueJob } from '@/lib/cron'
import { syncOnuTelemetryMonitorJob } from '@/lib/onu-monitoring'
import { syncOltTelemetryMonitorJob } from '@/lib/olt-monitoring'
import { cleanupNoisyProvisioningLogs } from '@/lib/provisioning-logs'

startCtoSyncJob()
startBillingAutomaticClosingJob()
startAccessControlJobs()
startNotificationQueueJob()

void cleanupNoisyProvisioningLogs()

if (process.env.ONU_MONITOR_AUTO_START !== 'false') {
  void syncOnuTelemetryMonitorJob({ runImmediately: false }).catch((error) => {
    console.error('[ONU MONITOR] falha ao sincronizar job no boot', error)
  })
}

if (process.env.OLT_MONITOR_AUTO_START !== 'false') {
  void syncOltTelemetryMonitorJob({ runImmediately: false }).catch((error) => {
    console.error('[OLT MONITOR] falha ao sincronizar job no boot', error)
  })
}
