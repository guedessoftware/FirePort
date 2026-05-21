import { prisma } from './prisma'
import { addProvisioningLog } from './provisioning-logs'
import { buildHubsoftProvisioningReference, releaseHubsoftPort, reserveHubsoftPort } from './hubsoft'

type HubsoftProvisioningContext = {
  id: string
  createdAt?: Date
  contract: {
    contractNumber: string
    landlord: {
      user: {
        id: string
      }
    }
  }
  portId: string
  port: {
    id: string
    hubsoftId?: string | null
    cto: {
      id: string
      name: string
      hubsoftId?: string | null
    }
  }
}

export type HubsoftReservationContext = {
  hubsoftCtoId: string
  hubsoftPortId: string
  reference: string
}

function resolveHubsoftReservationContext(provisioning: HubsoftProvisioningContext): HubsoftReservationContext {
  const hubsoftCtoId = provisioning.port.cto.hubsoftId
  const hubsoftPortId = provisioning.port.hubsoftId ?? provisioning.port.id

  if (!hubsoftCtoId) {
    throw new Error(`CTO ${provisioning.port.cto.name} nao possui vinculo Hubsoft. Provisionamento bloqueado para evitar divergencia.`)
  }

  if (!hubsoftPortId) {
    throw new Error('Porta selecionada nao possui id_porta_atendimento do Hubsoft. Provisionamento bloqueado para evitar divergencia.')
  }

  return {
    hubsoftCtoId,
    hubsoftPortId,
    reference: buildHubsoftProvisioningReference({
      userId: provisioning.contract.landlord.user.id,
      contractNumber: provisioning.contract.contractNumber,
      provisioningId: provisioning.id,
      createdAt: provisioning.createdAt,
    }),
  }
}

export async function reserveHubsoftPortForProvisioning(provisioning: HubsoftProvisioningContext) {
  let context: HubsoftReservationContext
  try {
    context = resolveHubsoftReservationContext(provisioning)
  } catch (error) {
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'error',
      stage: 'hubsoft.port.validation_failed',
      message: error instanceof Error ? error.message : 'Falha ao validar vinculo Hubsoft da porta.',
      details: {
        portId: provisioning.portId,
        ctoId: provisioning.port.cto.id,
        hubsoftCtoId: provisioning.port.cto.hubsoftId ?? null,
        hubsoftPortId: provisioning.port.hubsoftId ?? provisioning.port.id,
      },
    })
    throw error
  }

  await addProvisioningLog({
    provisioningId: provisioning.id,
    stage: 'hubsoft.port.reserve_started',
    message: 'Validacao pontual, referencia e reserva da porta no Hubsoft iniciadas.',
    details: context,
  })

  try {
    const result = await reserveHubsoftPort(context)
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'success',
      stage: 'hubsoft.port.reserve_finished',
      message: 'Porta reservada no Hubsoft com a referencia esperada.',
      details: {
        ...context,
        portNumber: result.port.number,
        rawStatus: result.port.rawStatus,
        reference: result.port.reference,
      },
    })
    return context
  } catch (error) {
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'error',
      stage: 'hubsoft.port.reserve_failed',
      message: `Provisionamento bloqueado: ${error instanceof Error ? error.message : 'falha ao reservar porta no Hubsoft.'}`,
      details: context,
    })
    throw error
  }
}

export async function releaseHubsoftPortForProvisioning(
  provisioning: HubsoftProvisioningContext,
  options?: { stagePrefix?: string; reason?: string },
) {
  const context = resolveHubsoftReservationContext(provisioning)
  const stagePrefix = options?.stagePrefix ?? 'hubsoft.port.release'

  await addProvisioningLog({
    provisioningId: provisioning.id,
    stage: `${stagePrefix}_started`,
    message: options?.reason ?? 'Liberacao da reserva Hubsoft iniciada.',
    details: context,
  })

  try {
    const result = await releaseHubsoftPort(context)
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'success',
      stage: `${stagePrefix}_finished`,
      message: 'Reserva Hubsoft liberada e referencia removida.',
      details: {
        ...context,
        rawStatus: result.port?.rawStatus ?? null,
        reference: result.port?.reference ?? null,
      },
    })
    return result
  } catch (error) {
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'error',
      stage: `${stagePrefix}_failed`,
      message: `Falha ao liberar reserva Hubsoft. Revisao manual pode ser necessaria: ${error instanceof Error ? error.message : String(error)}`,
      details: context,
    })
    throw error
  }
}

export async function rollbackHubsoftReservationAndLocalPort(
  provisioning: HubsoftProvisioningContext,
  reason: string,
) {
  await addProvisioningLog({
    provisioningId: provisioning.id,
    level: 'warn',
    stage: 'hubsoft.port.rollback_started',
    message: reason,
    details: {
      portId: provisioning.portId,
      ctoId: provisioning.port.cto.id,
    },
  })

  await releaseHubsoftPortForProvisioning(provisioning, {
    stagePrefix: 'hubsoft.port.rollback',
    reason: 'Rollback Hubsoft iniciado para liberar a porta e limpar referencia.',
  })

  await prisma.port.update({
    where: { id: provisioning.portId },
    data: { status: 'available' },
  })
  await prisma.provisioning.update({
    where: { id: provisioning.id },
    data: { status: 'inactive' },
  })

  await addProvisioningLog({
    provisioningId: provisioning.id,
    level: 'success',
    stage: 'hubsoft.port.rollback_local_finished',
    message: 'Rollback local concluido: porta liberada e provisionamento marcado como inativo.',
    details: {
      portId: provisioning.portId,
      status: 'inactive',
    },
  })
}
