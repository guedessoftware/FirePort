import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { checkSerialAvailableOnOlt, registerProvisioningOnOlt } from '@/lib/olt'
import { getDefaultOperatorProfile } from '@/lib/operator-profiles'
import { addProvisioningLog } from '@/lib/provisioning-logs'
import { attachProvisioningOnuTelemetry, attachSingleProvisioningOnuTelemetry } from '@/lib/provisioning-onu-telemetry'
import { grantOperatorOnuAccess, portToPonIndex } from '@/lib/onu-snmp'
import { reserveHubsoftPortForProvisioning, rollbackHubsoftReservationAndLocalPort } from '@/lib/hubsoft-provisioning'
import { activateBillingServiceForProvisioning } from '@/lib/billing'
import { assertPortalMutationAllowed } from '@/lib/access-control'
import { listErpLinksByContractIds } from '@/lib/erp/links'
import { attachGenieAcsDeviceAfterProvisioning } from '@/lib/genieacs'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessão inválida ou expirada. Faça login novamente.',
  }, { status: 401 })
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

async function findProvisioningBySerial(serial: string) {
  const rows = await prisma.$queryRaw<Array<{
    id: string
    status: string
    operatorUserId: string
    contractName: string
    contractNumber: string
  }>>`
    SELECT
      "Provisioning"."id",
      "Provisioning"."status",
      "Landlord"."userId" AS "operatorUserId",
      "Contract"."name" AS "contractName",
      "Contract"."contractNumber" AS "contractNumber"
    FROM "Provisioning"
    INNER JOIN "Contract" ON "Contract"."id" = "Provisioning"."contractId"
    INNER JOIN "Landlord" ON "Landlord"."id" = "Contract"."landlordId"
    WHERE lower("Provisioning"."serial") = lower(${serial.trim()})
    ORDER BY "Provisioning"."createdAt" DESC
    LIMIT 1
  `

  return rows[0] ?? null
}

export async function GET() {
  let session
  try {
    session = await getServerSession(authOptions)
  } catch (err) {
    console.error('Session error in GET provisionings:', err)
    return NextResponse.json({ error: 'Session error', details: String(err) }, { status: 500 })
  }
  
  if (!session) {
    return unauthorized()
  }

  const userId = (session.user as { id?: string } | undefined)?.id
  if (!userId) {
    return unauthorized()
  }

  let user
  try {
    user = await prisma.user.findUnique({ where: { id: userId } })
  } catch (err) {
    return NextResponse.json({ error: 'Database error', details: String(err) }, { status: 500 })
  }

  if (!user) {
    return unauthorized()
  }

  let provisionings
  try {
    provisionings = await prisma.provisioning.findMany({
      where: user.role === 'admin'
        ? undefined
        : { contract: { landlord: { userId: user.id } } },
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
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
          include: {
            cto: true,
          },
        },
        cpeModel: {
          select: { id: true, name: true, description: true },
        },
      },
    })
  } catch (err) {
    console.error('DB error:', err)
    return NextResponse.json({ error: 'Database error', details: String(err) }, { status: 500 })
  }
  
  const provisioningsWithTelemetry = await attachProvisioningOnuTelemetry(provisionings)
  const erpLinksByContractId = await listErpLinksByContractIds(
    provisioningsWithTelemetry.map((item) => item.contractId),
  )

  return NextResponse.json(provisioningsWithTelemetry.map((item) => ({
    ...item,
    contract: {
      ...item.contract,
      erpLink: erpLinksByContractId.get(item.contractId) ?? null,
    },
  })))
}

export async function POST(request: NextRequest) {
  let session
  try {
    session = await getServerSession(authOptions)
  } catch (err) {
    console.error('Session error in POST provisionings:', err)
    return NextResponse.json({ error: 'Session error', details: String(err) }, { status: 500 })
  }
  
  if (!session) {
    return unauthorized()
  }
  const userId = (session.user as { id?: string } | undefined)?.id
  if (!userId) {
    return unauthorized()
  }

  let body
  try {
    body = await request.json()
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON', details: String(err) }, { status: 400 })
  }

  const { contractId, portId, cpeModelId, serial } = body

  if (!contractId || !portId || !cpeModelId || !serial) {
    return NextResponse.json({ error: 'Missing required fields', details: { contractId: !!contractId, portId: !!portId, cpeModelId: !!cpeModelId, serial: !!serial } }, { status: 400 })
  }
  const cleanSerial = String(serial).trim()

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
        message: error instanceof Error ? error.message : 'Seu acesso nao permite novos provisionamentos no momento.',
      }, { status: 403 })
    }
  }

  const contract = await prisma.contract.findFirst({
    where: user.role === 'admin'
      ? { id: contractId }
      : { id: contractId, landlord: { userId: user.id } },
    include: {
      landlord: {
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  })

  if (!contract) {
    return NextResponse.json({ error: 'Contrato não encontrado para este usuário.' }, { status: 404 })
  }

  let port
  try {
    port = await prisma.port.findUnique({
      where: { id: portId },
      include: { cto: true },
    })
  } catch (err) {
    console.error('Port find error:', err)
    return NextResponse.json({ error: 'Database error', details: String(err) }, { status: 500 })
  }

  if (!port) {
    return NextResponse.json({
      error: 'Porta não encontrada.',
      message: 'A porta selecionada não existe mais. Atualize a lista de CTOs e tente novamente.',
    }, { status: 404 })
  }

  const existingProvisioningByPort = await prisma.provisioning.findUnique({
    where: { portId },
    include: provisioningInclude,
  })

  const existingBelongsToUser = user.role === 'admin' || existingProvisioningByPort?.contract.landlord.user.id === user.id
  const isSameProvisioningRequest = Boolean(
    existingProvisioningByPort
      && existingProvisioningByPort.contractId === contract.id
      && existingProvisioningByPort.cpeModelId === cpeModelId
      && existingProvisioningByPort.serial.toLowerCase() === cleanSerial.toLowerCase(),
  )
  const canReassignInactiveProvisioning = Boolean(
    existingProvisioningByPort
      && existingProvisioningByPort.status === 'inactive'
      && port.status === 'available',
  )

  if (existingProvisioningByPort && !existingBelongsToUser) {
    return NextResponse.json({
      error: 'Porta já provisionada.',
      message: 'Esta porta já está vinculada a um provisionamento de outro operador.',
    }, { status: 409 })
  }

  if (existingProvisioningByPort && !isSameProvisioningRequest && !canReassignInactiveProvisioning) {
    return NextResponse.json({
      error: 'Porta já provisionada.',
      message: `A porta selecionada já está vinculada ao contrato ${existingProvisioningByPort.contract.contractNumber}. Desprovisione o registro atual antes de reutilizar a porta.`,
      existingProvisioningId: existingProvisioningByPort.id,
      existingContract: {
        name: existingProvisioningByPort.contract.name,
        contractNumber: existingProvisioningByPort.contract.contractNumber,
      },
    }, { status: 409 })
  }

  if (!existingProvisioningByPort && port.status !== 'available') {
    return NextResponse.json({
      error: 'Port not available',
      message: 'A porta selecionada não está disponível.',
      portStatus: port.status,
    }, { status: 400 })
  }

  if (existingProvisioningByPort?.status === 'active') {
    return NextResponse.json({
      ...existingProvisioningByPort,
      reused: true,
      olt: {
        ok: true,
        status: 'active',
        message: 'Este provisionamento já está ativo na OLT.',
      },
    })
  }

  const operatorProfile = await getDefaultOperatorProfile(contract.landlord.user.id)
  if (!operatorProfile) {
    return NextResponse.json({
      error: 'Operador sem perfil operacional.',
      message: `Cadastre um perfil operacional para ${contract.landlord.user.name || contract.landlord.user.email} antes de provisionar.`,
    }, { status: 400 })
  }

  const shouldCheckSerialOnOlt = !existingProvisioningByPort || canReassignInactiveProvisioning
  const serialCheck = shouldCheckSerialOnOlt
    ? await checkSerialAvailableOnOlt(portId, cleanSerial, operatorProfile.driver as 'http-json' | 'zte-c650')
    : null
  if (serialCheck && !serialCheck.ok) {
    const existingProvisioning = serialCheck.exists
      ? await findProvisioningBySerial(String(serial))
      : null
    const belongsToSameOperator = existingProvisioning?.operatorUserId === contract.landlord.user.id
    const canResumeExistingProvisioning = Boolean(
      serialCheck.exists
        && existingProvisioning
        && belongsToSameOperator
        && ['olt_failed', 'olt_pending'].includes(existingProvisioning.status)
        && existingProvisioningByPort?.id === existingProvisioning.id,
    )

    if (canResumeExistingProvisioning && existingProvisioningByPort && existingProvisioning) {
      await addProvisioningLog({
        provisioningId: existingProvisioningByPort.id,
        level: 'warn',
        stage: 'olt.serial.precheck_resume',
        message: 'Serial encontrado na OLT e provisionamento local esta pendente/com falha; retomando provisionamento sem bloquear por duplicidade.',
        details: {
          serial: cleanSerial,
          serialCheck,
          existingProvisioningId: existingProvisioning.id,
          existingStatus: existingProvisioning.status,
        },
      })
    } else {
      return NextResponse.json({
        error: 'Serial já cadastrado ou não verificado na OLT.',
        message: serialCheck.exists && existingProvisioning
          ? belongsToSameOperator
            ? ['olt_failed', 'olt_pending'].includes(existingProvisioning.status)
              ? `A ONU/CPE ${serial} já existe na OLT e há um provisionamento pendente/com falha no contrato ${existingProvisioning.contractNumber}. Retome o registro OLT pelo provisionamento existente.`
              : `A ONU/CPE ${serial} já existe na OLT e pertence ao contrato ${existingProvisioning.contractNumber}. Desprovisione o registro existente antes de provisionar novamente.`
            : `A ONU/CPE ${serial} já existe na OLT e pertence a outro operador.`
          : serialCheck.message,
        serialCheck,
        canRetry: Boolean(serialCheck.exists && belongsToSameOperator && existingProvisioning && ['olt_failed', 'olt_pending'].includes(existingProvisioning.status)),
        canDeprovision: Boolean(serialCheck.exists && belongsToSameOperator),
        existingProvisioningId: serialCheck.exists && belongsToSameOperator ? existingProvisioning?.id : null,
        existingContract: existingProvisioning
          ? {
              name: existingProvisioning.contractName,
              contractNumber: existingProvisioning.contractNumber,
            }
          : null,
      }, { status: serialCheck.exists ? 409 : 400 })
    }
  }

  let provisioning = existingProvisioningByPort
  if (provisioning && canReassignInactiveProvisioning && !isSameProvisioningRequest) {
    const previousContract = {
      id: provisioning.contract.id,
      name: provisioning.contract.name,
      contractNumber: provisioning.contract.contractNumber,
    }
    provisioning = await prisma.provisioning.update({
      where: { id: provisioning.id },
      data: {
        contractId: contract.id,
        cpeModelId,
        serial: cleanSerial,
        status: 'olt_pending',
        signal: null,
      },
      include: provisioningInclude,
    })
    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'provisioning.reassigned',
      message: 'Provisionamento local inativo reutilizado para nova cliente.',
      details: {
        previousContract,
        contractId,
        portId,
        cpeModelId,
        serial: cleanSerial,
      },
    })
  } else if (provisioning) {
    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'provisioning.reused',
      message: 'Provisionamento local existente reutilizado para nova tentativa de registro na OLT.',
      details: { contractId, portId, cpeModelId, serial: cleanSerial },
    })
  } else {
    try {
      provisioning = await prisma.provisioning.create({
        data: {
          contractId,
          portId,
          cpeModelId,
          serial: cleanSerial,
          status: 'olt_pending',
        },
        include: provisioningInclude,
      })
      await addProvisioningLog({
        provisioningId: provisioning.id,
        stage: 'provisioning.created',
        message: 'Provisionamento local criado e aguardando registro na OLT.',
        details: { contractId, portId, cpeModelId, serial: cleanSerial },
      })
    } catch (err) {
      console.error('Provisioning create error:', err)
      return NextResponse.json({
        error: 'Falha ao criar provisionamento.',
        message: 'Não foi possível criar o provisionamento local. Atualize a lista de portas e tente novamente.',
        details: String(err),
      }, { status: 500 })
    }
  }

  try {
    await reserveHubsoftPortForProvisioning(provisioning)
  } catch (err) {
    console.error('Hubsoft reserve error:', err)
    await prisma.provisioning.update({
      where: { id: provisioning.id },
      data: { status: 'inactive' },
    }).catch((error) => {
      console.error('Failed to mark provisioning inactive after Hubsoft reserve failure:', error)
    })
    await prisma.port.update({
      where: { id: portId },
      data: { status: 'available' },
    }).catch((error) => {
      console.error('Failed to release local port after Hubsoft reserve failure:', error)
    })

    return NextResponse.json({
      error: 'Reserva Hubsoft falhou.',
      message: err instanceof Error
        ? err.message
        : 'Provisionamento bloqueado porque a reserva da porta no Hubsoft nao foi concluida.',
    }, { status: 409 })
  }

  try {
    await prisma.port.update({
      where: { id: portId },
      data: { status: 'provisioned' },
    })
    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'port.reserved',
      message: 'Porta da CTO reservada localmente.',
      details: { portId },
    })
  } catch (err) {
    console.error('Port update error:', err)
    try {
      await rollbackHubsoftReservationAndLocalPort(
        provisioning,
        'Falha ao atualizar porta local apos reserva Hubsoft. Rollback iniciado antes de chamar a OLT.',
      )
    } catch (rollbackError) {
      console.error('Rollback after local port update failure failed:', rollbackError)
    }
    await addProvisioningLog({
      provisioningId: provisioning.id,
      level: 'error',
      stage: 'port.reserve_failed',
      message: 'Nao foi possivel atualizar o status da porta local. Provisionamento bloqueado antes da OLT.',
      details: { portId, error: String(err) },
    })
    return NextResponse.json({
      error: 'Falha ao reservar porta local.',
      message: 'A reserva Hubsoft foi desfeita porque a porta local nao pode ser marcada como provisionada.',
    }, { status: 500 })
  }

  await addProvisioningLog({
    provisioningId: provisioning.id,
    stage: 'olt.registration_started',
    message: 'Registro automatico na OLT iniciado.',
    details: { contractId, portId, cpeModelId },
  })
  const oltResult = await registerProvisioningOnOlt(provisioning.id)
  await addProvisioningLog({
    provisioningId: provisioning.id,
    level: oltResult.ok ? 'success' : oltResult.status === 'olt_pending' ? 'warn' : 'error',
    stage: 'olt.registration_finished',
    message: oltResult.message,
    details: {
      status: oltResult.status,
      driver: oltResult.driver,
      commandCount: oltResult.commands?.length ?? 0,
    },
  })
  if (oltResult.status !== provisioning.status) {
    provisioning = await prisma.provisioning.update({
      where: { id: provisioning.id },
      data: { status: oltResult.status },
      include: provisioningInclude,
    })
  }
  if (!oltResult.ok) {
    try {
      await rollbackHubsoftReservationAndLocalPort(
        provisioning,
        'Registro na OLT falhou apos reserva Hubsoft. Rollback iniciado para evitar divergencia.',
      )
      provisioning = await prisma.provisioning.findUnique({
        where: { id: provisioning.id },
        include: provisioningInclude,
      }) ?? provisioning
      const provisioningWithTelemetry = await attachSingleProvisioningOnuTelemetry(provisioning)

      return NextResponse.json({
        ...provisioningWithTelemetry,
        reused: Boolean(existingProvisioningByPort),
        error: 'Registro OLT falhou.',
        message: `${oltResult.message} Reserva Hubsoft e porta local foram desfeitas.`,
        olt: oltResult,
      }, { status: 400 })
    } catch (rollbackError) {
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'error',
        stage: 'hubsoft.port.rollback_failed',
        message: 'Rollback apos falha OLT nao foi concluido. Revisao manual necessaria para evitar divergencia.',
        details: {
          oltResult,
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        },
      })

      return NextResponse.json({
        ...provisioning,
        reused: Boolean(existingProvisioningByPort),
        error: 'Registro OLT falhou e rollback incompleto.',
        message: 'A OLT falhou e nao foi possivel concluir o rollback Hubsoft/local. Revise os logs do provisionamento.',
        olt: oltResult,
      }, { status: 500 })
    }
  }
  if (oltResult.ok && oltResult.onuPosition) {
    await grantOperatorOnuAccess({
      userId: provisioning.contract.landlord.user.id,
      oltId: oltResult.onuPosition.oltDeviceId,
      ponIndex: portToPonIndex(`${oltResult.onuPosition.chassi}/${oltResult.onuPosition.slot}/${oltResult.onuPosition.pon}`),
      onuId: oltResult.onuPosition.onuId,
    })
  }
  if (oltResult.ok) {
    try {
      await activateBillingServiceForProvisioning(provisioning.id)
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'success',
        stage: 'billing.service.activated',
        message: 'Servico cobravel ativado para o faturamento da rede neutra.',
      })
    } catch (billingError) {
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'error',
        stage: 'billing.service.activation_failed',
        message: 'Provisionamento ativado, mas o servico cobravel nao foi criado. Revise o modulo financeiro.',
        details: {
          error: billingError instanceof Error ? billingError.message : String(billingError),
        },
      })
    }
  }
  let genieAcsResult: Awaited<ReturnType<typeof attachGenieAcsDeviceAfterProvisioning>> | null = null
  if (oltResult.ok) {
    await addProvisioningLog({
      provisioningId: provisioning.id,
      stage: 'genieacs.association_started',
      message: 'Buscando CPE ativa no GenieACS pelo serial GPON.',
      details: { serial: provisioning.serial },
    })
    try {
      genieAcsResult = await attachGenieAcsDeviceAfterProvisioning(provisioning.id, provisioning.serial)
    } catch (genieAcsError) {
      genieAcsResult = {
        ok: false,
        skipped: false,
        summary: null,
        message: genieAcsError instanceof Error ? genieAcsError.message : String(genieAcsError),
      }
      await addProvisioningLog({
        provisioningId: provisioning.id,
        level: 'warn',
        stage: 'genieacs.association_failed',
        message: 'Provisionamento ativado, mas a associação GenieACS falhou.',
        details: { error: genieAcsResult.message },
      })
    }
  }
  const provisioningWithTelemetry = await attachSingleProvisioningOnuTelemetry(provisioning)

  return NextResponse.json({
    ...provisioningWithTelemetry,
    reused: Boolean(existingProvisioningByPort),
    olt: oltResult,
    genieAcs: genieAcsResult,
  })
}
