import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { assertPortalMutationAllowed } from '@/lib/access-control'
import { addProvisioningLog } from '@/lib/provisioning-logs'
import { deprovisionProvisioningOnOlt, registerProvisioningOnOlt } from '@/lib/olt'
import { attachSingleProvisioningOnuTelemetry, clearProvisioningOnuTelemetry } from '@/lib/provisioning-onu-telemetry'
import { activateBillingServiceForProvisioning } from '@/lib/billing'
import { releaseHubsoftPortForProvisioning, reserveHubsoftPortForProvisioning } from '@/lib/hubsoft-provisioning'
import { grantOperatorOnuAccess, portToPonIndex } from '@/lib/onu-snmp'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessão inválida ou expirada. Faça login novamente.',
  }, { status: 401 })
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  const clean = text(value)
  return clean || null
}

function coordinate(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isValidCoordinate(lat: number | null, lng: number | null) {
  return lat !== null
    && lng !== null
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
    && lat !== 0
    && lng !== 0
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

export async function POST(request: NextRequest, context: RouteContext<'/api/provisionings/[id]/maneuver'>) {
  try {
    const session = await getServerSession(authOptions)
    const userId = (session?.user as { id?: string } | undefined)?.id
    if (!userId) return unauthorized()

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return unauthorized()

    if (user.role !== 'admin') {
      try {
        await assertPortalMutationAllowed(user.id, 'provision')
      } catch (error) {
        return NextResponse.json({
          error: 'Acesso bloqueado.',
          message: error instanceof Error ? error.message : 'Seu acesso nao permite manobrar provisionamentos no momento.',
        }, { status: 403 })
      }
    }

    const body = await request.json().catch(() => ({}))
    const targetPortId = typeof body.targetPortId === 'string' ? body.targetPortId.trim() : ''
    const address = text(body.address)
    const number = text(body.number)
    const cep = text(body.cep).replace(/\D/g, '')
    const complement = optionalText(body.complement)
    const reference = optionalText(body.reference)
    const lat = coordinate(body.lat)
    const lng = coordinate(body.lng)
    if (!targetPortId) {
      return NextResponse.json({ error: 'Informe a porta de destino.' }, { status: 400 })
    }
    if (!address || !number || !cep || !isValidCoordinate(lat, lng)) {
      return NextResponse.json({
        error: 'Novo endereco invalido.',
        message: 'Informe novo CEP, endereco, numero e georreferencia valida antes de manobrar.',
      }, { status: 400 })
    }
    if (cep.length !== 8) {
      return NextResponse.json({ error: 'CEP invalido. Informe 8 digitos.' }, { status: 400 })
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

    const targetPort = await prisma.port.findUnique({
      where: { id: targetPortId },
      include: {
        cto: true,
        provisioning: {
          include: {
            contract: {
              include: {
                landlord: {
                  include: {
                    user: {
                      select: { id: true, email: true, name: true, role: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!targetPort) {
      return NextResponse.json({ error: 'Porta de destino nao encontrada.' }, { status: 404 })
    }

    const isSamePortRetry = provisioning.portId === targetPortId
    if (isSamePortRetry && provisioning.status === 'active') {
      return NextResponse.json({ error: 'A porta de destino ja e a porta atual deste provisionamento ativo.' }, { status: 400 })
    }

    if (isSamePortRetry) {
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'warn',
        stage: 'cto.maneuver.reprovision_retry_requested',
        message: `Reprovisionamento solicitado na propria porta atual ${targetPort.cto.name} porta ${targetPort.number} apos manobra incompleta.`,
        details: {
          requestedBy: user.id,
          targetPortId,
          targetCtoId: targetPort.cto.id,
          currentStatus: provisioning.status,
          nextAddress: {
            cep,
            address,
            number,
            complement,
            reference,
            lat,
            lng,
          },
        },
      })

      await prisma.contract.update({
        where: { id: provisioning.contractId },
        data: {
          cep,
          address,
          number,
          complement,
          reference,
          lat: lat as number,
          lng: lng as number,
        },
      })

      let retryProvisioning = await prisma.provisioning.update({
        where: { id: provisioning.id },
        data: {
          status: 'olt_pending',
          signal: null,
        },
        include: provisioningInclude,
      })

      try {
        await reserveHubsoftPortForProvisioning(retryProvisioning)
        await prisma.port.update({
          where: { id: targetPort.id },
          data: { status: 'provisioned' },
        })
      } catch (reserveError) {
        await prisma.provisioning.update({
          where: { id: retryProvisioning.id },
          data: { status: 'inactive' },
        })
        return NextResponse.json({
          success: false,
          error: 'Falha ao reservar porta de destino.',
          message: errorMessage(reserveError, 'Nao foi possivel reservar novamente a porta atual para reprovisionar. Revise os logs antes de tentar novamente.'),
        }, { status: 409 })
      }

      let registerResult: Awaited<ReturnType<typeof registerProvisioningOnOlt>>
      try {
        registerResult = await registerProvisioningOnOlt(retryProvisioning.id)
      } catch (registerError) {
        registerResult = {
          ok: false,
          status: 'olt_failed',
          message: errorMessage(registerError, 'Falha ao reprovisionar a ONU/CPE na OLT.'),
        }
      }

      await addProvisioningLog({
        provisioningId: retryProvisioning.id,
        level: registerResult.ok ? 'success' : registerResult.status === 'olt_pending' ? 'warn' : 'error',
        stage: 'cto.maneuver.reprovision_retry_finished',
        message: registerResult.message,
        details: {
          status: registerResult.status,
          driver: registerResult.driver,
          commandCount: registerResult.commands?.length ?? 0,
        },
      })

      if (!registerResult.ok) {
        retryProvisioning = await prisma.provisioning.update({
          where: { id: retryProvisioning.id },
          data: { status: registerResult.status },
          include: provisioningInclude,
        })

        return NextResponse.json({
          success: false,
          error: 'Reprovisionamento OLT falhou.',
          message: `${registerResult.message} O cadastro permaneceu na nova porta para permitir nova tentativa de reprovisionamento.`,
          provisioning: await attachSingleProvisioningOnuTelemetry(retryProvisioning),
          olt: registerResult,
        }, { status: 400 })
      }

      retryProvisioning = await prisma.provisioning.update({
        where: { id: retryProvisioning.id },
        data: { status: registerResult.status },
        include: provisioningInclude,
      })
      if (registerResult.onuPosition) {
        await grantOperatorOnuAccess({
          userId: retryProvisioning.contract.landlord.user.id,
          oltId: registerResult.onuPosition.oltDeviceId,
          ponIndex: portToPonIndex(`${registerResult.onuPosition.chassi}/${registerResult.onuPosition.slot}/${registerResult.onuPosition.pon}`),
          onuId: registerResult.onuPosition.onuId,
        })
      }

      try {
        await activateBillingServiceForProvisioning(retryProvisioning.id)
        await addProvisioningLog({
          provisioningId: retryProvisioning.id,
          level: 'success',
          stage: 'cto.maneuver.billing_updated',
          message: 'Servico cobravel reativado apos reprovisionamento da manobra.',
        })
      } catch (billingError) {
        await addProvisioningLog({
          provisioningId: retryProvisioning.id,
          level: 'error',
          stage: 'cto.maneuver.billing_update_failed',
          message: 'Reprovisionamento concluido, mas o servico cobravel nao foi atualizado.',
          details: {
            error: billingError instanceof Error ? billingError.message : String(billingError),
          },
        })
      }

      return NextResponse.json({
        success: true,
        message: `Reprovisionamento concluido em ${targetPort.cto.name} porta ${targetPort.number}.`,
        provisioning: await attachSingleProvisioningOnuTelemetry(retryProvisioning),
        olt: registerResult,
      })
    }

    if (targetPort.status !== 'available') {
      return NextResponse.json({
        error: 'Porta indisponivel.',
        message: `A porta ${targetPort.number} da CTO ${targetPort.cto.name} nao esta disponivel.`,
      }, { status: 400 })
    }

    if (targetPort.provisioning && targetPort.provisioning.status !== 'inactive') {
      return NextResponse.json({
        error: 'Porta ja vinculada.',
        message: `A porta de destino ja esta vinculada ao contrato ${targetPort.provisioning.contract.contractNumber}.`,
      }, { status: 409 })
    }

    if (targetPort.provisioning && user.role !== 'admin' && targetPort.provisioning.contract.landlord.user.id !== user.id) {
      return NextResponse.json({
        error: 'Porta ja possui historico de outro operador.',
        message: 'Escolha uma porta sem provisionamento vinculado a outro operador.',
      }, { status: 409 })
    }

    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'cto.maneuver.requested',
      message: `Manobra solicitada da CTO ${provisioning.port.cto.name} porta ${provisioning.port.number} para ${targetPort.cto.name} porta ${targetPort.number}.`,
      details: {
        requestedBy: user.id,
        fromPortId: provisioning.portId,
        fromCtoId: provisioning.port.cto.id,
        targetPortId,
        targetCtoId: targetPort.cto.id,
        previousAddress: {
          cep: provisioning.contract.cep,
          address: provisioning.contract.address,
          number: provisioning.contract.number,
          lat: provisioning.contract.lat,
          lng: provisioning.contract.lng,
        },
        nextAddress: {
          cep,
          address,
          number,
          complement,
          reference,
          lat,
          lng,
        },
      },
    })

    let deprovisionResult: Awaited<ReturnType<typeof deprovisionProvisioningOnOlt>>
    try {
      deprovisionResult = await deprovisionProvisioningOnOlt(provisioning.id)
    } catch (deprovisionError) {
      const message = errorMessage(deprovisionError, 'Falha ao desprovisionar a ONU/CPE na OLT.')
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'error',
        stage: 'cto.maneuver.deprovision_failed',
        message,
      })

      return NextResponse.json({
        success: false,
        error: 'Desprovisionamento OLT falhou.',
        message,
      }, { status: 400 })
    }
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: deprovisionResult.ok ? 'success' : deprovisionResult.status === 'olt_pending' ? 'warn' : 'error',
      stage: 'cto.maneuver.deprovision_finished',
      message: deprovisionResult.message,
      details: {
        status: deprovisionResult.status,
        driver: deprovisionResult.driver,
        commandCount: deprovisionResult.commands?.length ?? 0,
      },
    })

    if (!deprovisionResult.ok) {
      return NextResponse.json({
        success: false,
        error: 'Desprovisionamento OLT falhou.',
        message: `Manobra interrompida: ${deprovisionResult.message}`,
        olt: deprovisionResult,
      }, { status: 400 })
    }

    try {
      await releaseHubsoftPortForProvisioning(provisioning, {
        stagePrefix: 'cto.maneuver.old_port_release',
        reason: 'Manobra CTO: OLT removeu a ONU/CPE. Liberando a porta antiga antes de mover o cadastro.',
      })
    } catch (releaseError) {
      return NextResponse.json({
        success: false,
        error: 'Falha ao liberar porta antiga.',
        message: errorMessage(releaseError, 'A ONU/CPE foi removida da OLT, mas a porta antiga nao foi liberada no Hubsoft.'),
      }, { status: 500 })
    }

    await prisma.port.update({
      where: { id: provisioning.portId },
      data: { status: 'available' },
    })
    await clearProvisioningOnuTelemetry(provisioning.id)

    if (targetPort.provisioning?.status === 'inactive') {
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'warn',
        stage: 'cto.maneuver.target_history_removed',
        message: `Historico inativo da porta de destino removido para permitir a manobra para ${targetPort.cto.name} porta ${targetPort.number}.`,
        details: {
          removedProvisioningId: targetPort.provisioning.id,
          removedContractNumber: targetPort.provisioning.contract.contractNumber,
        },
      })
      await prisma.provisioning.delete({ where: { id: targetPort.provisioning.id } })
    }

    let movedProvisioning = await prisma.provisioning.update({
      where: { id: provisioning.id },
      data: {
        portId: targetPort.id,
        status: 'olt_pending',
        signal: null,
      },
      include: provisioningInclude,
    })

    await prisma.contract.update({
      where: { id: provisioning.contractId },
      data: {
        cep,
        address,
        number,
        complement,
        reference,
        lat: lat as number,
        lng: lng as number,
      },
    })

    await addProvisioningLog({
      provisioningId: movedProvisioning.id,
      stage: 'cto.maneuver.moved',
      message: `Cadastro movido para ${targetPort.cto.name} porta ${targetPort.number} com novo endereco do cliente.`,
      details: {
        targetPortId: targetPort.id,
        targetCtoId: targetPort.cto.id,
        address,
        number,
        cep,
        complement,
        reference,
        lat,
        lng,
      },
    })

    try {
      await reserveHubsoftPortForProvisioning(movedProvisioning)
      await prisma.port.update({
        where: { id: targetPort.id },
        data: { status: 'provisioned' },
      })
    } catch (reserveError) {
      await addProvisioningLog({
        provisioningId: movedProvisioning.id,
        level: 'error',
        stage: 'cto.maneuver.target_reserve_failed',
        message: errorMessage(reserveError, 'Falha ao reservar a porta de destino.'),
      })
      await prisma.provisioning.update({
        where: { id: movedProvisioning.id },
        data: { status: 'inactive' },
      })
      return NextResponse.json({
        success: false,
        error: 'Falha ao reservar porta de destino.',
        message: errorMessage(reserveError, 'Cadastro movido, mas a porta de destino nao foi reservada. Revise os logs antes de tentar novamente.'),
      }, { status: 409 })
    }

    let registerResult: Awaited<ReturnType<typeof registerProvisioningOnOlt>>
    try {
      registerResult = await registerProvisioningOnOlt(movedProvisioning.id)
    } catch (registerError) {
      registerResult = {
        ok: false,
        status: 'olt_failed',
        message: errorMessage(registerError, 'Falha ao reprovisionar a ONU/CPE na OLT.'),
      }
    }
    await addProvisioningLog({
      provisioningId: movedProvisioning.id,
      level: registerResult.ok ? 'success' : registerResult.status === 'olt_pending' ? 'warn' : 'error',
      stage: 'cto.maneuver.reprovision_finished',
      message: registerResult.message,
      details: {
        status: registerResult.status,
        driver: registerResult.driver,
        commandCount: registerResult.commands?.length ?? 0,
      },
    })

    if (!registerResult.ok) {
      movedProvisioning = await prisma.provisioning.update({
        where: { id: movedProvisioning.id },
        data: { status: registerResult.status },
        include: provisioningInclude,
      })

      await addProvisioningLog({
        provisioningId: movedProvisioning.id,
        level: 'warn',
        stage: 'cto.maneuver.reprovision_recovery_available',
        message: 'Manobra preservada na porta de destino para permitir nova tentativa de reprovisionamento.',
        details: {
          targetPortId: movedProvisioning.portId,
          status: registerResult.status,
        },
      })

      return NextResponse.json({
        success: false,
        error: 'Reprovisionamento OLT falhou.',
        message: `${registerResult.message} O cadastro foi mantido na nova CTO/porta para permitir nova tentativa de reprovisionamento.`,
        provisioning: await attachSingleProvisioningOnuTelemetry(movedProvisioning),
        olt: registerResult,
      }, { status: 400 })
    }

    movedProvisioning = await prisma.provisioning.update({
      where: { id: movedProvisioning.id },
      data: { status: registerResult.status },
      include: provisioningInclude,
    })
    if (registerResult.onuPosition) {
      await grantOperatorOnuAccess({
        userId: movedProvisioning.contract.landlord.user.id,
        oltId: registerResult.onuPosition.oltDeviceId,
        ponIndex: portToPonIndex(`${registerResult.onuPosition.chassi}/${registerResult.onuPosition.slot}/${registerResult.onuPosition.pon}`),
        onuId: registerResult.onuPosition.onuId,
      })
    }

    try {
      await activateBillingServiceForProvisioning(movedProvisioning.id)
      await addProvisioningLog({
        provisioningId: movedProvisioning.id,
        level: 'success',
        stage: 'cto.maneuver.billing_updated',
        message: 'Servico cobravel atualizado para a nova CTO/porta.',
      })
    } catch (billingError) {
      await addProvisioningLog({
        provisioningId: movedProvisioning.id,
        level: 'error',
        stage: 'cto.maneuver.billing_update_failed',
        message: 'Manobra concluida, mas o servico cobravel nao foi atualizado.',
        details: {
          error: billingError instanceof Error ? billingError.message : String(billingError),
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Manobra concluida para ${targetPort.cto.name} porta ${targetPort.number}.`,
      provisioning: await attachSingleProvisioningOnuTelemetry(movedProvisioning),
      olt: registerResult,
    })
  } catch (error) {
    console.error('[API CTO MANEUVER] falha inesperada', error)
    const message = errorMessage(error, 'Erro ao manobrar CTO.')
    return NextResponse.json({
      success: false,
      error: message,
      message,
    }, { status: 500 })
  }
}
