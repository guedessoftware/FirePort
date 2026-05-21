import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { deprovisionProvisioningOnOlt, registerProvisioningOnOlt } from '@/lib/olt'
import { runOnuTelemetryMonitorNow } from '@/lib/onu-monitoring'
import { grantOperatorOnuAccess, portToPonIndex, syncProvisioningTelemetryFromOnuCurrent } from '@/lib/onu-snmp'
import { addProvisioningLog } from '@/lib/provisioning-logs'
import { attachSingleProvisioningOnuTelemetry, clearProvisioningOnuTelemetry } from '@/lib/provisioning-onu-telemetry'
import { releaseHubsoftPortForProvisioning, reserveHubsoftPortForProvisioning, rollbackHubsoftReservationAndLocalPort } from '@/lib/hubsoft-provisioning'
import { activateBillingServiceForProvisioning, cancelBillingServiceForProvisioning } from '@/lib/billing'
import { assertPortalMutationAllowed } from '@/lib/access-control'
import { attachGenieAcsDeviceAfterProvisioning } from '@/lib/genieacs'
import { authOptions } from '../../../auth/[...nextauth]/route'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessão inválida ou expirada. Faça login novamente.',
  }, { status: 401 })
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error) {
    return error
  }

  return fallback
}

const provisioningInclude = {
  contract: {
    include: {
      landlord: {
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      },
    },
  },
  port: {
    include: { cto: true },
  },
  cpeModel: {
    select: { id: true, name: true, description: true },
  },
}

function hasSnmpTelemetry(provisioning: {
  signal?: number | null
  onuStatus?: string | null
  onuRxPower?: number | null
  onuTxPower?: number | null
}) {
  return provisioning.signal != null
    || Boolean(provisioning.onuStatus)
    || provisioning.onuRxPower != null
    || provisioning.onuTxPower != null
}

export async function POST(_request: NextRequest, context: RouteContext<'/api/provisionings/[id]/olt'>) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return unauthorized()
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    return unauthorized()
  }
  if (user.role !== 'admin') {
    try {
      await assertPortalMutationAllowed(user.id, 'provision')
    } catch (error) {
      return NextResponse.json({
        error: 'Acesso bloqueado.',
        message: error instanceof Error ? error.message : 'Seu acesso nao permite alterar provisionamentos no momento.',
      }, { status: 403 })
    }
  }

  const { id } = await context.params
  const provisioning = await prisma.provisioning.findFirst({
    where: user.role === 'admin'
      ? { id }
      : { id, contract: { landlord: { userId: user.id } } },
    include: provisioningInclude,
  })

  if (!provisioning) {
    return NextResponse.json({ error: 'Provisionamento não encontrado para este usuário.' }, { status: 404 })
  }

  if (provisioning.status === 'active') {
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'success',
      stage: 'olt.retry_skipped',
      message: 'Registro OLT ignorado porque o provisionamento ja esta ativo.',
    })
    return NextResponse.json({
      success: true,
      status: provisioning.status,
      message: 'Este provisionamento já está ativo na OLT.',
    })
  }

  await addProvisioningLog({
    provisioningId: provisioning.id,
    stage: 'olt.retry_started',
    message: 'Nova tentativa de registro na OLT iniciada.',
  })

  try {
    await reserveHubsoftPortForProvisioning(provisioning)
    await prisma.port.update({
      where: { id: provisioning.portId },
      data: { status: 'provisioned' },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Reserva Hubsoft falhou.',
      message: error instanceof Error
        ? error.message
        : 'Retry OLT bloqueado porque a reserva Hubsoft nao foi concluida.',
    }, { status: 409 })
  }

  const oltResult = await registerProvisioningOnOlt(provisioning.id)
  await addProvisioningLog({
    provisioningId: provisioning.id,
    level: oltResult.ok ? 'success' : oltResult.status === 'olt_pending' ? 'warn' : 'error',
    stage: 'olt.retry_finished',
    message: oltResult.message,
    details: {
      status: oltResult.status,
      driver: oltResult.driver,
      commandCount: oltResult.commands?.length ?? 0,
    },
  })
  if (!oltResult.ok) {
    try {
      await rollbackHubsoftReservationAndLocalPort(
        provisioning,
        'Retry OLT falhou apos reserva Hubsoft. Rollback iniciado para evitar divergencia.',
      )
      const rolledBackProvisioning = await prisma.provisioning.findUnique({
        where: { id: provisioning.id },
        include: provisioningInclude,
      })
      const rolledBackProvisioningWithTelemetry = await attachSingleProvisioningOnuTelemetry(rolledBackProvisioning ?? provisioning)

      return NextResponse.json({
        success: false,
        error: 'Registro OLT falhou.',
        message: `${oltResult.message} Reserva Hubsoft e porta local foram desfeitas.`,
        provisioning: rolledBackProvisioningWithTelemetry,
        olt: oltResult,
      }, { status: 400 })
    } catch (rollbackError) {
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'error',
        stage: 'hubsoft.port.rollback_failed',
        message: 'Rollback apos falha no retry OLT nao foi concluido. Revisao manual necessaria.',
        details: {
          oltResult,
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        },
      })

      return NextResponse.json({
        success: false,
        error: 'Registro OLT falhou e rollback incompleto.',
        message: 'A OLT falhou e nao foi possivel concluir o rollback Hubsoft/local. Revise os logs do provisionamento.',
        olt: oltResult,
      }, { status: 500 })
    }
  }

  const updatedProvisioning = await prisma.provisioning.update({
    where: { id: provisioning.id },
    data: { status: oltResult.status },
    include: provisioningInclude,
  })
  if (oltResult.ok && oltResult.onuPosition) {
    await grantOperatorOnuAccess({
      userId: updatedProvisioning.contract.landlord.user.id,
      oltId: oltResult.onuPosition.oltDeviceId,
      ponIndex: portToPonIndex(`${oltResult.onuPosition.chassi}/${oltResult.onuPosition.slot}/${oltResult.onuPosition.pon}`),
      onuId: oltResult.onuPosition.onuId,
    })
  }
  try {
    await activateBillingServiceForProvisioning(updatedProvisioning.id)
    await addProvisioningLog({
      provisioningId: updatedProvisioning.id,
      level: 'success',
      stage: 'billing.service.activated',
      message: 'Servico cobravel ativado para o faturamento da rede neutra.',
    })
  } catch (billingError) {
    await addProvisioningLog({
      provisioningId: updatedProvisioning.id,
      level: 'error',
      stage: 'billing.service.activation_failed',
      message: 'Provisionamento ativado, mas o servico cobravel nao foi criado. Revise o modulo financeiro.',
      details: {
        error: billingError instanceof Error ? billingError.message : String(billingError),
      },
    })
  }
  let genieAcsResult: Awaited<ReturnType<typeof attachGenieAcsDeviceAfterProvisioning>> | null = null
  await addProvisioningLog({
    provisioningId: updatedProvisioning.id,
    stage: 'genieacs.association_started',
    message: 'Buscando CPE ativa no GenieACS pelo serial GPON.',
    details: { serial: updatedProvisioning.serial },
  })
  try {
    genieAcsResult = await attachGenieAcsDeviceAfterProvisioning(updatedProvisioning.id, updatedProvisioning.serial)
  } catch (genieAcsError) {
    genieAcsResult = {
      ok: false,
      skipped: false,
      summary: null,
      message: genieAcsError instanceof Error ? genieAcsError.message : String(genieAcsError),
    }
    await addProvisioningLog({
      provisioningId: updatedProvisioning.id,
      level: 'warn',
      stage: 'genieacs.association_failed',
      message: 'Provisionamento ativado, mas a associação GenieACS falhou.',
      details: { error: genieAcsResult.message },
    })
  }
  const updatedProvisioningWithTelemetry = await attachSingleProvisioningOnuTelemetry(updatedProvisioning)

  return NextResponse.json({
    success: oltResult.ok,
    provisioning: updatedProvisioningWithTelemetry,
    olt: oltResult,
    genieAcs: genieAcsResult,
  })
}

export async function PATCH(_request: NextRequest, context: RouteContext<'/api/provisionings/[id]/olt'>) {
  try {
    const session = await getServerSession(authOptions)
    const userId = (session?.user as { id?: string } | undefined)?.id

    if (!userId) {
      return unauthorized()
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'admin') {
      try {
        await assertPortalMutationAllowed(user.id, 'provision')
      } catch (error) {
        return NextResponse.json({
          error: 'Acesso bloqueado.',
          message: error instanceof Error ? error.message : 'Seu acesso nao permite desprovisionar no momento.',
        }, { status: 403 })
      }
    }

    const { id } = await context.params
    const provisioning = await prisma.provisioning.findFirst({
      where: user.role === 'admin'
        ? { id }
        : { id, contract: { landlord: { userId: user.id } } },
      include: provisioningInclude,
    })

    if (!provisioning) {
      return NextResponse.json({ error: 'Provisionamento não encontrado para este usuário.' }, { status: 404 })
    }

    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'onu.snmp.refresh_started',
      message: 'Atualizacao das informacoes da ONU/CPE iniciada via SNMP.',
    })

    let monitorResult: Awaited<ReturnType<typeof runOnuTelemetryMonitorNow>> | null = null
    let monitorError: string | null = null
    try {
      monitorResult = await runOnuTelemetryMonitorNow()
    } catch (error) {
      monitorError = errorMessage(error, 'Erro ao executar monitoramento SNMP.')
      await syncProvisioningTelemetryFromOnuCurrent()
    }

    const updatedProvisioning = await prisma.provisioning.findUnique({
      where: { id: provisioning.id },
      include: provisioningInclude,
    })
    const updatedProvisioningWithTelemetry = updatedProvisioning
      ? await attachSingleProvisioningOnuTelemetry(updatedProvisioning)
      : null
    const telemetryFound = updatedProvisioningWithTelemetry ? hasSnmpTelemetry(updatedProvisioningWithTelemetry) : false
    const ok = Boolean(updatedProvisioningWithTelemetry && telemetryFound && !monitorResult?.error)
    const message = monitorError
      ? `Monitoramento SNMP não executado agora: ${monitorError}. Dados atuais sincronizados a partir da ultima coleta disponível.`
      : telemetryFound
        ? `Monitoramento SNMP executado. ${monitorResult?.success ?? 0} ONUs coletadas, ${monitorResult?.failed ?? 0} falhas.`
        : 'Monitoramento SNMP executado, mas ainda não há leitura vinculada para esta ONU/CPE.'

    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: ok ? 'success' : telemetryFound ? 'warn' : 'error',
      stage: 'onu.snmp.refresh_finished',
      message,
      details: {
        monitorResult,
        monitorError,
        telemetryFound,
      },
    })

    return NextResponse.json({
      success: ok,
      error: ok ? undefined : message,
      message,
      provisioning: updatedProvisioningWithTelemetry,
      olt: {
        ok,
        status: updatedProvisioning?.status ?? provisioning.status,
        driver: 'snmp',
        message,
        monitor: monitorResult,
      },
    }, { status: ok ? 200 : 400 })
  } catch (error) {
    console.error('[API OLT ONU REFRESH] falha inesperada', error)
    const message = errorMessage(error, 'Erro ao atualizar informações da ONU/CPE.')
    return NextResponse.json({
      success: false,
      error: message,
      message,
    }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<'/api/provisionings/[id]/olt'>) {
  try {
    const session = await getServerSession(authOptions)
    const userId = (session?.user as { id?: string } | undefined)?.id

    if (!userId) {
      return unauthorized()
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'admin') {
      try {
        await assertPortalMutationAllowed(user.id, 'provision')
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 403 })
      }
    }

    const { id } = await context.params
    const provisioning = await prisma.provisioning.findFirst({
      where: user.role === 'admin'
        ? { id }
        : { id, contract: { landlord: { userId: user.id } } },
      include: {
        contract: {
          include: {
            landlord: {
              include: {
                user: {
                  select: { id: true, name: true, email: true, role: true },
                },
              },
            },
          },
        },
        port: {
          include: { cto: true },
        },
        cpeModel: {
          select: { id: true, name: true, description: true },
        },
      },
    })

    if (!provisioning) {
      return NextResponse.json({ error: 'Provisionamento não encontrado para este usuário.' }, { status: 404 })
    }

    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'olt.deprovision.requested',
      message: 'Desprovisionamento da ONU/CPE solicitado.',
      details: {
        requestedBy: user.id,
        requestedByRole: user.role,
      },
    })

    const oltResult = await deprovisionProvisioningOnOlt(provisioning.id)
    const oltMessage = oltResult.message || 'Desprovisionamento OLT falhou sem mensagem detalhada.'
    const oltStatus = oltResult.status || 'olt_failed'
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: oltResult.ok ? 'success' : oltStatus === 'olt_pending' ? 'warn' : 'error',
      stage: 'olt.deprovision.finished',
      message: oltMessage,
      details: {
        status: oltStatus,
        driver: oltResult.driver,
        commandCount: oltResult.commands?.length ?? 0,
      },
    })

    let updatedProvisioning = provisioning
    if (oltResult.ok) {
      try {
        await releaseHubsoftPortForProvisioning(provisioning, {
          stagePrefix: 'hubsoft.port.deprovision_release',
          reason: 'OLT confirmou desprovisionamento. Liberando reserva Hubsoft antes de atualizar o banco local.',
        })
      } catch (releaseError) {
        console.error('[API OLT DEPROVISION] falha ao liberar Hubsoft', releaseError)
        await addProvisioningLog({
          provisioningId: provisioning.id,
          level: 'error',
          stage: 'hubsoft.port.deprovision_release_blocked_local_update',
          message: 'Desprovisionamento OLT concluido, mas Hubsoft nao liberou a porta. Banco local nao foi liberado para evitar reutilizacao indevida.',
          details: {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
          },
        })

        return NextResponse.json({
          success: false,
          error: 'Falha ao liberar porta no Hubsoft.',
          message: 'A ONU/CPE foi removida da OLT, mas a porta nao foi liberada no Hubsoft. Revise os logs antes de reutilizar esta porta.',
          provisioning: await attachSingleProvisioningOnuTelemetry(provisioning),
          olt: {
            ...oltResult,
            status: oltStatus,
            message: oltMessage,
          },
        }, { status: 500 })
      }

      await prisma.port.update({
        where: { id: provisioning.portId },
        data: { status: 'available' },
      })
      updatedProvisioning = await prisma.provisioning.update({
        where: { id: provisioning.id },
        data: { status: 'inactive' },
        include: provisioningInclude,
      })
      await prisma.$executeRaw`
        UPDATE "Provisioning"
        SET "genieAcsDeviceId" = NULL,
            "genieAcsSerialParameter" = NULL,
            "genieAcsLinkedAt" = NULL,
            "genieAcsLastInformAt" = NULL,
            "genieAcsLastSyncAt" = NULL,
            "genieAcsSummaryJson" = NULL
        WHERE "id" = ${provisioning.id}
      `
      try {
        await cancelBillingServiceForProvisioning(provisioning.id)
        await addProvisioningLog({
          provisioningId: provisioning.id,
          level: 'success',
          stage: 'billing.service.canceled',
          message: 'Servico cobravel cancelado para os proximos fechamentos.',
        })
      } catch (billingError) {
        await addProvisioningLog({
          provisioningId: provisioning.id,
          level: 'error',
          stage: 'billing.service.cancel_failed',
          message: 'Provisionamento desprovisionado, mas o servico cobravel nao foi cancelado. Revise o modulo financeiro.',
          details: {
            error: billingError instanceof Error ? billingError.message : String(billingError),
          },
        })
      }
      await clearProvisioningOnuTelemetry(provisioning.id)
    }
    const updatedProvisioningWithTelemetry = await attachSingleProvisioningOnuTelemetry(updatedProvisioning)

    return NextResponse.json({
      success: oltResult.ok,
      error: oltResult.ok ? undefined : oltMessage,
      message: oltMessage,
      provisioning: updatedProvisioningWithTelemetry,
      olt: {
        ...oltResult,
        status: oltStatus,
        message: oltMessage,
      },
    }, { status: oltResult.ok ? 200 : 400 })
  } catch (error) {
    console.error('[API OLT DEPROVISION] falha inesperada', error)
    const message = errorMessage(error, 'Erro ao desprovisionar ONU/CPE.')
    return NextResponse.json({
      success: false,
      error: message,
      message,
    }, { status: 500 })
  }
}
