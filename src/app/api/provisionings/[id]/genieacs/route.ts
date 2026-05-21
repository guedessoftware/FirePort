import { NextRequest, NextResponse } from 'next/server'
import { requireAuthenticated } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { addProvisioningLog } from '@/lib/provisioning-logs'
import {
  attachGenieAcsDeviceToProvisioning,
  listGenieAcsConnectedDevices,
  setGenieAcsWifi,
} from '@/lib/genieacs'

async function findAllowedProvisioning(user: { id: string; role: string }, id: string) {
  const rows = await prisma.$queryRaw<Array<{
    id: string
    serial: string
    status: string
    genieAcsDeviceId: string | null
    genieAcsSerialParameter: string | null
    genieAcsLinkedAt: Date | string | null
    genieAcsLastInformAt: Date | string | null
    genieAcsLastSyncAt: Date | string | null
    genieAcsSummaryJson: string | null
    contract: string | { name: string; contractNumber: string }
  }>>`
    SELECT
      "Provisioning"."id",
      "Provisioning"."serial",
      "Provisioning"."status",
      "Provisioning"."genieAcsDeviceId",
      "Provisioning"."genieAcsSerialParameter",
      "Provisioning"."genieAcsLinkedAt",
      "Provisioning"."genieAcsLastInformAt",
      "Provisioning"."genieAcsLastSyncAt",
      "Provisioning"."genieAcsSummaryJson",
      json_object('name', "Contract"."name", 'contractNumber', "Contract"."contractNumber") AS "contract"
    FROM "Provisioning"
    INNER JOIN "Contract" ON "Contract"."id" = "Provisioning"."contractId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "Contract"."landlordId"
    WHERE "Provisioning"."id" = ${id}
      AND (${user.role === 'admin'} OR "Landlord"."userId" = ${user.id})
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    genieAcsLinkedAt: row.genieAcsLinkedAt ? new Date(row.genieAcsLinkedAt).toISOString() : null,
    genieAcsLastInformAt: row.genieAcsLastInformAt ? new Date(row.genieAcsLastInformAt).toISOString() : null,
    genieAcsLastSyncAt: row.genieAcsLastSyncAt ? new Date(row.genieAcsLastSyncAt).toISOString() : null,
    contract: typeof row.contract === 'string' ? JSON.parse(row.contract) as { name: string; contractNumber: string } : row.contract,
  }
}

function parseSummary(value?: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function GET(_request: NextRequest, context: RouteContext<'/api/provisionings/[id]/genieacs'>) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await context.params
  const provisioning = await findAllowedProvisioning(auth.user, id)
  if (!provisioning) {
    return NextResponse.json({ error: 'Provisionamento nao encontrado.' }, { status: 404 })
  }

  try {
    const connected = await listGenieAcsConnectedDevices(provisioning)
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: connected.queued ? 'warn' : 'success',
      stage: 'genieacs.hosts.refreshed',
      message: connected.queued
        ? 'Consulta de dispositivos conectados enfileirada no GenieACS.'
        : 'Dispositivos conectados consultados no GenieACS.',
      details: { deviceId: connected.deviceId, hostCount: connected.hosts.length, queued: connected.queued },
    })

    return NextResponse.json({
      provisioning: {
        ...provisioning,
        genieAcsSummary: parseSummary(provisioning.genieAcsSummaryJson),
      },
      ...connected,
    })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Erro ao consultar GenieACS.' }, { status: 400 })
  }
}

export async function POST(_request: NextRequest, context: RouteContext<'/api/provisionings/[id]/genieacs'>) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await context.params
  const provisioning = await findAllowedProvisioning(auth.user, id)
  if (!provisioning) {
    return NextResponse.json({ error: 'Provisionamento nao encontrado.' }, { status: 404 })
  }

  try {
    const result = await attachGenieAcsDeviceToProvisioning(provisioning.id, provisioning.serial)
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: result.ok ? 'success' : result.skipped ? 'warn' : 'error',
      stage: 'genieacs.association_manual',
      message: result.message,
      details: { summary: result.summary },
    })
    return NextResponse.json(result, { status: result.ok || result.skipped ? 200 : 404 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Erro ao associar GenieACS.' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext<'/api/provisionings/[id]/genieacs'>) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await context.params
  const provisioning = await findAllowedProvisioning(auth.user, id)
  if (!provisioning) {
    return NextResponse.json({ error: 'Provisionamento nao encontrado.' }, { status: 404 })
  }
  if (provisioning.status !== 'active') {
    return NextResponse.json({ error: 'A CPE precisa estar ativa para alterar Wi-Fi pelo GenieACS.' }, { status: 409 })
  }

  try {
    const body = await request.json()
    const result = await setGenieAcsWifi(provisioning, {
      ssid: typeof body.ssid === 'string' ? body.ssid : undefined,
      password: typeof body.password === 'string' ? body.password : undefined,
      ssid5: typeof body.ssid5 === 'string' ? body.ssid5 : undefined,
      password5: typeof body.password5 === 'string' ? body.password5 : undefined,
    })
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: result.queued ? 'warn' : 'success',
      stage: 'genieacs.wifi.updated',
      message: result.queued
        ? 'Alteracao de Wi-Fi enfileirada no GenieACS.'
        : 'Alteracao de Wi-Fi enviada ao GenieACS.',
      details: { deviceId: result.deviceId, changed: result.changed, queued: result.queued },
    })

    return NextResponse.json({
      ok: true,
      message: result.queued
        ? 'Alteracao enviada ao GenieACS e enfileirada para o proximo inform da CPE.'
        : 'Alteracao enviada ao roteador pelo GenieACS.',
      ...result,
    })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Erro ao alterar Wi-Fi.' }, { status: 400 })
  }
}
