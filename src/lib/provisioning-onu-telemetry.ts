import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export type ProvisioningOnuTelemetry = {
  signal: number | null
  onuStatus: string | null
  onuDistanceMeters: number | null
  onuOnlineDuration: string | null
  onuRxPower: number | null
  onuTxPower: number | null
}

export async function clearProvisioningOnuTelemetry(provisioningId: string) {
  await prisma.$executeRaw`
    UPDATE "Provisioning"
    SET
      "signal" = NULL,
      "onuStatus" = NULL,
      "onuDistanceMeters" = NULL,
      "onuOnlineDuration" = NULL,
      "onuRxPower" = NULL,
      "onuTxPower" = NULL
    WHERE "id" = ${provisioningId}
  `
}

export async function getProvisioningOnuTelemetryByIds(ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, ProvisioningOnuTelemetry>()
  }

  const rows = await prisma.$queryRaw<Array<ProvisioningOnuTelemetry & { id: string }>>`
    SELECT
      "id",
      "signal",
      "onuStatus",
      "onuDistanceMeters",
      "onuOnlineDuration",
      "onuRxPower",
      "onuTxPower"
    FROM "Provisioning"
    WHERE "id" IN (${Prisma.join(ids)})
  `

  return new Map(rows.map((row) => [row.id, {
    signal: row.signal,
    onuStatus: row.onuStatus,
    onuDistanceMeters: row.onuDistanceMeters,
    onuOnlineDuration: row.onuOnlineDuration,
    onuRxPower: row.onuRxPower,
    onuTxPower: row.onuTxPower,
  }]))
}

export async function attachProvisioningOnuTelemetry<T extends { id: string }>(items: T[]) {
  const telemetryById = await getProvisioningOnuTelemetryByIds(items.map((item) => item.id))
  return items.map((item) => ({
    ...item,
    ...telemetryById.get(item.id),
  }))
}

export async function attachSingleProvisioningOnuTelemetry<T extends { id: string }>(item: T) {
  const [withTelemetry] = await attachProvisioningOnuTelemetry([item])
  return withTelemetry
}
