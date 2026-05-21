import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { ensureBillingAccountForLandlord, updateBillingAccount } from '@/lib/billing'
import { isValidCnpj, normalizeCnpj } from '@/lib/cnpj'
import { fetchHubsoftClientByCnpj, type HubsoftClient } from '@/lib/hubsoft'
import { upsertOperatorProfile } from '@/lib/operator-profiles'
import { getPasswordPolicyError, hashPassword, isValidEmail, normalizeEmail } from '@/lib/auth-security'
import { listOltDrivers } from '@/lib/olt'
import { authOptions } from '../auth/[...nextauth]/route'

let operatorHubsoftSchemaReady: Promise<void> | null = null

async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  })
  const mfaVerified = (session?.user as { mfaVerified?: boolean } | undefined)?.mfaVerified === true

  if (user?.role === 'admin' && !mfaVerified) {
    return null
  }

  return user
}

function forbidden() {
  return NextResponse.json({ error: 'Apenas administradores podem gerenciar usuários.' }, { status: 403 })
}

async function ensureOperatorHubsoftSchema() {
  operatorHubsoftSchemaReady ??= (async () => {
    const columns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("Landlord")`
    const columnNames = new Set(columns.map((column) => column.name))
    const ensureColumn = async (name: string, statement: string) => {
      if (!columnNames.has(name)) {
        await prisma.$executeRawUnsafe(statement)
      }
    }

    await ensureColumn('document', 'ALTER TABLE "Landlord" ADD COLUMN "document" TEXT')
    await ensureColumn('hubsoftClientId', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftClientId" TEXT')
    await ensureColumn('hubsoftClientUuid', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftClientUuid" TEXT')
    await ensureColumn('hubsoftClientCode', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftClientCode" INTEGER')
    await ensureColumn('hubsoftLegalName', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftLegalName" TEXT')
    await ensureColumn('hubsoftTradeName', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftTradeName" TEXT')
    await ensureColumn('hubsoftPersonType', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftPersonType" TEXT')
    await ensureColumn('hubsoftPrimaryPhone', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftPrimaryPhone" TEXT')
    await ensureColumn('hubsoftSecondaryPhone', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftSecondaryPhone" TEXT')
    await ensureColumn('hubsoftPrimaryEmail', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftPrimaryEmail" TEXT')
    await ensureColumn('hubsoftMunicipalRegistration', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftMunicipalRegistration" TEXT')
    await ensureColumn('hubsoftStateRegistration', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftStateRegistration" TEXT')
    await ensureColumn('hubsoftOrigin', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftOrigin" TEXT')
    await ensureColumn('hubsoftActive', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftActive" BOOLEAN NOT NULL DEFAULT false')
    await ensureColumn('hubsoftImportedAt', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftImportedAt" DATETIME')
    await ensureColumn('hubsoftRegisteredAt', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftRegisteredAt" DATETIME')
    await ensureColumn('hubsoftUpdatedAt', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftUpdatedAt" DATETIME')
    await ensureColumn('hubsoftRawJson', 'ALTER TABLE "Landlord" ADD COLUMN "hubsoftRawJson" TEXT')
  })().catch((error) => {
    operatorHubsoftSchemaReady = null
    throw error
  })

  return operatorHubsoftSchemaReady
}

function normalizeVlan(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const vlan = Number(value)
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) {
    return undefined
  }

  return vlan
}

function selectHubsoftBillingService(client: HubsoftClient) {
  return client.services.find((service) => {
    const statusPrefix = String(service.statusPrefix ?? '').trim().toLowerCase()
    const status = String(service.status ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    return statusPrefix === 'servico_habilitado' || status === 'servico habilitado'
  }) ?? null
}

function normalizeOptionalId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeProfileNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} deve ser numerico.`)
  }
  return parsed
}

function validOltDriver(driver: string) {
  return listOltDrivers().some((item) => item.id === driver)
}

async function applyProvisioningProfileSelection(userId: string, profileId: unknown, profileInput?: unknown) {
  if (profileInput && typeof profileInput === 'object') {
    const input = profileInput as Record<string, unknown>
    const id = normalizeOptionalId(input.id)
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const driver = typeof input.driver === 'string' ? input.driver.trim() : ''
    const vlan = normalizeProfileNumber(input.vlan, 'VLAN do perfil operacional')
    const serviceVlan = normalizeProfileNumber(input.serviceVlan, 'Service VLAN')
    const gemPort = normalizeProfileNumber(input.gemPort, 'GEM Port')
    const tcont = normalizeProfileNumber(input.tcont, 'TCONT')

    if (!name || !driver || vlan === null) {
      throw new Error('Perfil operacional exige nome, driver e VLAN.')
    }
    if (!validOltDriver(driver)) {
      throw new Error('Driver OLT inválido no perfil operacional.')
    }

    let safeProfileId: string | undefined
    if (id) {
      const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId" FROM "ProvisioningProfile" WHERE "id" = ${id} LIMIT 1
      `
      if (rows[0]?.userId === userId) {
        safeProfileId = id
      }
    }

    await upsertOperatorProfile({
      id: safeProfileId,
      userId,
      name,
      driver,
      vlan,
      serviceVlan,
      lineProfile: optionalText(input.lineProfile),
      serviceProfile: optionalText(input.serviceProfile),
      gemPort,
      tcont,
      serviceName: optionalText(input.serviceName),
      isDefault: true,
    })
    return
  }

  const sourceProfileId = normalizeOptionalId(profileId)
  if (!sourceProfileId) return

  const rows = await prisma.$queryRaw<Array<{
    id: string
    userId: string
    name: string
    driver: string
    vlan: number | null
    serviceVlan: number | null
    lineProfile: string | null
    serviceProfile: string | null
    gemPort: number | null
    tcont: number | null
    serviceName: string | null
  }>>`
    SELECT
      "id",
      "userId",
      "name",
      "driver",
      "vlan",
      "serviceVlan",
      "lineProfile",
      "serviceProfile",
      "gemPort",
      "tcont",
      "serviceName"
    FROM "ProvisioningProfile"
    WHERE "id" = ${sourceProfileId}
    LIMIT 1
  `
  const source = rows[0]
  if (!source) {
    throw new Error('Perfil operacional selecionado nao foi encontrado.')
  }

  await upsertOperatorProfile({
    id: source.userId === userId ? source.id : undefined,
    userId,
    name: source.name,
    driver: source.driver,
    vlan: source.vlan,
    serviceVlan: source.serviceVlan,
    lineProfile: source.lineProfile,
    serviceProfile: source.serviceProfile,
    gemPort: source.gemPort,
    tcont: source.tcont,
    serviceName: source.serviceName,
    isDefault: true,
  })
}

async function fetchRequiredHubsoftOperator(cnpj: unknown) {
  const normalizedCnpj = normalizeCnpj(cnpj)
  if (!normalizedCnpj || !isValidCnpj(normalizedCnpj)) {
    throw new Error('Informe um CNPJ valido para cadastrar operador. CPF nao e aceito.')
  }

  const client = await fetchHubsoftClientByCnpj(normalizedCnpj)
  if (!client) {
    throw new Error('Cliente nao encontrado no Hubsoft para este CNPJ.')
  }
  if (client.personType !== 'pj') {
    throw new Error('O cadastro do operador aceita somente cliente PJ/CNPJ do Hubsoft.')
  }

  return client
}

async function writeOperatorHubsoftImport(landlordId: string, client: HubsoftClient) {
  await ensureOperatorHubsoftSchema()
  const service = selectHubsoftBillingService(client)
  if (!service) {
    throw new Error('Cliente Hubsoft sem servico ativo. O operador precisa ter ao menos um servico habilitado.')
  }

  await prisma.$executeRaw`
    UPDATE "Landlord"
    SET
      "document" = ${client.cnpj},
      "name" = ${client.legalName},
      "hubsoftClientId" = ${client.idCliente},
      "hubsoftClientUuid" = ${client.uuidCliente},
      "hubsoftClientCode" = ${client.codigoCliente},
      "hubsoftLegalName" = ${client.legalName},
      "hubsoftTradeName" = ${client.tradeName},
      "hubsoftPersonType" = ${client.personType},
      "hubsoftPrimaryPhone" = ${client.primaryPhone},
      "hubsoftSecondaryPhone" = ${client.secondaryPhone},
      "hubsoftPrimaryEmail" = ${client.primaryEmail},
      "hubsoftMunicipalRegistration" = ${client.municipalRegistration},
      "hubsoftStateRegistration" = ${client.stateRegistration},
      "hubsoftOrigin" = ${client.origin},
      "hubsoftActive" = ${client.active},
      "hubsoftImportedAt" = CURRENT_TIMESTAMP,
      "hubsoftRegisteredAt" = ${client.registeredAt},
      "hubsoftUpdatedAt" = ${client.updatedAt},
      "hubsoftRawJson" = ${JSON.stringify(client.raw)}
    WHERE "id" = ${landlordId}
  `

  const account = await ensureBillingAccountForLandlord(landlordId)
  await prisma.$executeRaw`
    UPDATE "BillingAccount"
    SET
      "hubsoftClientServiceId" = ${service.idClienteServico},
      "hubsoftServiceName" = ${service.name},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${account.id}
  `
}

async function updateOperatorCommercialRule(landlordId: string, input: Record<string, unknown>) {
  const account = await ensureBillingAccountForLandlord(landlordId)
  const update: Record<string, unknown> = {}

  if (normalizeOptionalId(input.hubsoftClientServiceId)) {
    update.hubsoftClientServiceId = input.hubsoftClientServiceId
  }
  if (input.minimumAmountCents !== undefined) update.minimumAmountCents = input.minimumAmountCents
  if (input.includedProvisionings !== undefined) update.includedProvisionings = input.includedProvisionings
  if (input.extraProvisioningAmountCents !== undefined) update.extraProvisioningAmountCents = input.extraProvisioningAmountCents
  if (input.dueDay !== undefined) update.dueDay = input.dueDay
  if (input.status !== undefined) update.status = input.status
  if (input.notes !== undefined) update.notes = input.notes

  if (Object.keys(update).length) {
    await updateBillingAccount(account.id, update)
  }
}

function numberFromDatabase(value: unknown) {
  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'number') {
    return value
  }

  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET() {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 })
    }
    if (currentUser.role !== 'admin') {
      return forbidden()
    }
    await ensureOperatorHubsoftSchema()

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        landlord: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    const vlanRows = await prisma.$queryRaw<{ id: string; vlan: number | null }[]>`
      SELECT id, vlan FROM User
    `
    const vlanByUserId = new Map(vlanRows.map((row) => [row.id, row.vlan]))
    const profileRows = await prisma.$queryRaw<Array<{
      userId: string
      profileCount: number
      defaultProfileId: string | null
      defaultProfileName: string | null
      defaultProfileVlan: number | null
    }>>`
      SELECT
        User.id AS userId,
        COUNT(ProvisioningProfile.id) AS profileCount,
        (
          SELECT id
          FROM ProvisioningProfile
          WHERE ProvisioningProfile.userId = User.id
          ORDER BY isDefault DESC, updatedAt DESC
          LIMIT 1
        ) AS defaultProfileId,
        (
          SELECT name
          FROM ProvisioningProfile
          WHERE ProvisioningProfile.userId = User.id
          ORDER BY isDefault DESC, updatedAt DESC
          LIMIT 1
        ) AS defaultProfileName,
        (
          SELECT vlan
          FROM ProvisioningProfile
          WHERE ProvisioningProfile.userId = User.id
          ORDER BY isDefault DESC, updatedAt DESC
          LIMIT 1
        ) AS defaultProfileVlan
      FROM User
      LEFT JOIN ProvisioningProfile ON ProvisioningProfile.userId = User.id
      GROUP BY User.id
    `
    const profileByUserId = new Map(profileRows.map((row) => [row.userId, row]))
    const hubsoftRows = await prisma.$queryRaw<Array<{
      userId: string
      cnpj: string | null
      hubsoftClientId: string | null
      hubsoftClientUuid: string | null
      hubsoftClientCode: number | null
      hubsoftLegalName: string | null
      hubsoftTradeName: string | null
      hubsoftPrimaryPhone: string | null
      hubsoftSecondaryPhone: string | null
      hubsoftPrimaryEmail: string | null
      hubsoftMunicipalRegistration: string | null
      hubsoftStateRegistration: string | null
      hubsoftRegisteredAt: string | null
      hubsoftImportedAt: string | null
      billingAccountId: string | null
      hubsoftClientServiceId: string | null
      hubsoftServiceName: string | null
      minimumAmountCents: number | null
      includedProvisionings: number | null
      extraProvisioningAmountCents: number | null
      dueDay: number | null
      billingStatus: string | null
      billingNotes: string | null
    }>>`
      SELECT
        "Landlord"."userId" AS "userId",
        "Landlord"."document" AS "cnpj",
        "Landlord"."hubsoftClientId" AS "hubsoftClientId",
        "Landlord"."hubsoftClientUuid" AS "hubsoftClientUuid",
        "Landlord"."hubsoftClientCode" AS "hubsoftClientCode",
        "Landlord"."hubsoftLegalName" AS "hubsoftLegalName",
        "Landlord"."hubsoftTradeName" AS "hubsoftTradeName",
        "Landlord"."hubsoftPrimaryPhone" AS "hubsoftPrimaryPhone",
        "Landlord"."hubsoftSecondaryPhone" AS "hubsoftSecondaryPhone",
        "Landlord"."hubsoftPrimaryEmail" AS "hubsoftPrimaryEmail",
        "Landlord"."hubsoftMunicipalRegistration" AS "hubsoftMunicipalRegistration",
        "Landlord"."hubsoftStateRegistration" AS "hubsoftStateRegistration",
        "Landlord"."hubsoftRegisteredAt" AS "hubsoftRegisteredAt",
        "Landlord"."hubsoftImportedAt" AS "hubsoftImportedAt",
        "BillingAccount"."id" AS "billingAccountId",
        "BillingAccount"."hubsoftClientServiceId" AS "hubsoftClientServiceId",
        "BillingAccount"."hubsoftServiceName" AS "hubsoftServiceName",
        "BillingAccount"."minimumAmountCents" AS "minimumAmountCents",
        "BillingAccount"."includedProvisionings" AS "includedProvisionings",
        "BillingAccount"."extraProvisioningAmountCents" AS "extraProvisioningAmountCents",
        "BillingAccount"."dueDay" AS "dueDay",
        "BillingAccount"."status" AS "billingStatus",
        "BillingAccount"."notes" AS "billingNotes"
      FROM "Landlord"
      LEFT JOIN "BillingAccount" ON "BillingAccount"."landlordId" = "Landlord"."id"
    `
    const hubsoftByUserId = new Map(hubsoftRows.map((row) => [row.userId, row]))

    return NextResponse.json(users.map((user) => ({
      ...user,
      vlan: vlanByUserId.get(user.id) ?? null,
      cnpj: hubsoftByUserId.get(user.id)?.cnpj ?? null,
      hubsoftClientId: hubsoftByUserId.get(user.id)?.hubsoftClientId ?? null,
      hubsoftClientUuid: hubsoftByUserId.get(user.id)?.hubsoftClientUuid ?? null,
      hubsoftClientCode: numberFromDatabase(hubsoftByUserId.get(user.id)?.hubsoftClientCode),
      hubsoftLegalName: hubsoftByUserId.get(user.id)?.hubsoftLegalName ?? null,
      hubsoftTradeName: hubsoftByUserId.get(user.id)?.hubsoftTradeName ?? null,
      hubsoftPrimaryPhone: hubsoftByUserId.get(user.id)?.hubsoftPrimaryPhone ?? null,
      hubsoftSecondaryPhone: hubsoftByUserId.get(user.id)?.hubsoftSecondaryPhone ?? null,
      hubsoftPrimaryEmail: hubsoftByUserId.get(user.id)?.hubsoftPrimaryEmail ?? null,
      hubsoftMunicipalRegistration: hubsoftByUserId.get(user.id)?.hubsoftMunicipalRegistration ?? null,
      hubsoftStateRegistration: hubsoftByUserId.get(user.id)?.hubsoftStateRegistration ?? null,
      hubsoftRegisteredAt: hubsoftByUserId.get(user.id)?.hubsoftRegisteredAt ?? null,
      hubsoftImportedAt: hubsoftByUserId.get(user.id)?.hubsoftImportedAt ?? null,
      billingAccountId: hubsoftByUserId.get(user.id)?.billingAccountId ?? null,
      hubsoftClientServiceId: hubsoftByUserId.get(user.id)?.hubsoftClientServiceId ?? null,
      hubsoftServiceName: hubsoftByUserId.get(user.id)?.hubsoftServiceName ?? null,
      minimumAmountCents: numberFromDatabase(hubsoftByUserId.get(user.id)?.minimumAmountCents),
      includedProvisionings: numberFromDatabase(hubsoftByUserId.get(user.id)?.includedProvisionings),
      extraProvisioningAmountCents: numberFromDatabase(hubsoftByUserId.get(user.id)?.extraProvisioningAmountCents),
      dueDay: numberFromDatabase(hubsoftByUserId.get(user.id)?.dueDay),
      billingStatus: hubsoftByUserId.get(user.id)?.billingStatus ?? null,
      billingNotes: hubsoftByUserId.get(user.id)?.billingNotes ?? null,
      provisioningProfileCount: numberFromDatabase(profileByUserId.get(user.id)?.profileCount) ?? 0,
      defaultProvisioningProfile: profileByUserId.get(user.id)?.defaultProfileName
        ? {
            id: profileByUserId.get(user.id)?.defaultProfileId ?? '',
            name: profileByUserId.get(user.id)?.defaultProfileName ?? '',
            vlan: numberFromDatabase(profileByUserId.get(user.id)?.defaultProfileVlan),
          }
        : null,
    })))
  } catch (error) {
    console.error('User list error:', error)
    return NextResponse.json({ error: 'Erro ao listar usuários.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 })
    }
    if (currentUser.role !== 'admin') {
      return forbidden()
    }
    await ensureOperatorHubsoftSchema()

    const {
      email,
      password,
      name,
      role,
      vlan,
      cnpj,
      provisioningProfileId,
      hubsoftClientServiceId,
      minimumAmountCents,
      includedProvisionings,
      extraProvisioningAmountCents,
      dueDay,
      billingStatus,
      billingNotes,
      provisioningProfile,
    } = await request.json()
    const safeRole = role === 'admin' ? 'admin' : 'landlord'
    const hubsoftClient = safeRole === 'landlord' ? await fetchRequiredHubsoftOperator(cnpj) : null
    const safeName = hubsoftClient?.legalName ?? String(name ?? '').trim()
    const safeEmail = normalizeEmail(hubsoftClient?.primaryEmail ?? String(email ?? ''))

    if (!safeEmail || !password || !safeName) {
      return NextResponse.json({ error: 'Nome, email e senha são obrigatórios.' }, { status: 400 })
    }
    if (!isValidEmail(safeEmail)) {
      return NextResponse.json({ error: 'Informe um email valido.' }, { status: 400 })
    }
    const passwordPolicyError = getPasswordPolicyError(String(password), safeEmail)
    if (passwordPolicyError) {
      return NextResponse.json({ error: passwordPolicyError }, { status: 400 })
    }

    const safeVlan = normalizeVlan(vlan)
    if (safeVlan === undefined) {
      return NextResponse.json({ error: 'VLAN deve ser um número entre 1 e 4094.' }, { status: 400 })
    }

    const existingUser = await prisma.user.findUnique({ where: { email: safeEmail } })
    if (existingUser) {
      return NextResponse.json({ error: 'Já existe um usuário com este email.' }, { status: 400 })
    }

    const hashedPassword = await hashPassword(String(password))
    const user = await prisma.user.create({
      data: {
        email: safeEmail,
        password: hashedPassword,
        name: safeName,
        role: safeRole,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    })

    let landlord: { id: string } | null = null
    if (safeRole === 'landlord') {
      landlord = await prisma.landlord.create({
        data: {
          name: safeName,
          userId: user.id,
        },
        select: { id: true },
      })
    }
    if (landlord && hubsoftClient) {
      await writeOperatorHubsoftImport(landlord.id, hubsoftClient)
      await updateOperatorCommercialRule(landlord.id, {
        hubsoftClientServiceId,
        minimumAmountCents,
        includedProvisionings,
        extraProvisioningAmountCents,
        dueDay,
        status: billingStatus,
        notes: billingNotes,
      })
    }

    if (safeVlan !== null) {
      await prisma.$executeRaw`
        UPDATE User SET vlan = ${safeVlan}, updatedAt = CURRENT_TIMESTAMP WHERE id = ${user.id}
      `
    }
    if (safeRole === 'landlord') {
      await applyProvisioningProfileSelection(user.id, provisioningProfileId, provisioningProfile)
    }

    return NextResponse.json({ ...user, vlan: safeVlan, cnpj: hubsoftClient?.cnpj ?? null }, { status: 201 })
  } catch (error) {
    console.error('User create error:', error)
    const message = (error as Error).message || 'Erro ao criar usuário.'
    const status = message.includes('CNPJ') || message.includes('Hubsoft') || message.includes('Perfil') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 })
    }
    if (currentUser.role !== 'admin') {
      return forbidden()
    }
    await ensureOperatorHubsoftSchema()

    const {
      id,
      email,
      name,
      role,
      password,
      vlan,
      cnpj,
      provisioningProfileId,
      hubsoftClientServiceId,
      minimumAmountCents,
      includedProvisionings,
      extraProvisioningAmountCents,
      dueDay,
      billingStatus,
      billingNotes,
      provisioningProfile,
    } = await request.json()
    if (!id) {
      return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 })
    }

    const safeVlan = normalizeVlan(vlan)
    if (safeVlan === undefined) {
      return NextResponse.json({ error: 'VLAN deve ser um número entre 1 e 4094.' }, { status: 400 })
    }

    const safeRole = role === 'admin' ? 'admin' : 'landlord'
    const hubsoftClient = safeRole === 'landlord' ? await fetchRequiredHubsoftOperator(cnpj) : null
    const safeName = hubsoftClient?.legalName ?? String(name ?? '').trim()
    const safeEmail = normalizeEmail(hubsoftClient?.primaryEmail ?? String(email ?? ''))
    const data: { email?: string; name?: string; role?: string; password?: string } = {}
    if (safeEmail) {
      if (!isValidEmail(safeEmail)) {
        return NextResponse.json({ error: 'Informe um email valido.' }, { status: 400 })
      }
      const existingUser = await prisma.user.findFirst({
        where: {
          email: safeEmail,
          NOT: { id },
        },
      })
      if (existingUser) {
        return NextResponse.json({ error: 'Já existe um usuário com este email.' }, { status: 400 })
      }
      data.email = safeEmail
    }
    if (safeName) data.name = safeName
    if (role) data.role = safeRole
    if (password) {
      const passwordPolicyError = getPasswordPolicyError(String(password), safeEmail)
      if (passwordPolicyError) {
        return NextResponse.json({ error: passwordPolicyError }, { status: 400 })
      }
      data.password = await hashPassword(String(password))
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    })

    if (safeName) {
      await prisma.landlord.updateMany({
        where: { userId: id },
        data: { name: safeName },
      })
    }

    const landlord = await prisma.landlord.findUnique({ where: { userId: id }, select: { id: true } })
    let operatorLandlord = landlord
    if (safeRole === 'landlord' && !operatorLandlord) {
      operatorLandlord = await prisma.landlord.create({
        data: {
          name: safeName || updatedUser.name,
          userId: id,
        },
        select: { id: true },
      })
    }
    if (operatorLandlord && hubsoftClient) {
      await writeOperatorHubsoftImport(operatorLandlord.id, hubsoftClient)
      await updateOperatorCommercialRule(operatorLandlord.id, {
        hubsoftClientServiceId,
        minimumAmountCents,
        includedProvisionings,
        extraProvisioningAmountCents,
        dueDay,
        status: billingStatus,
        notes: billingNotes,
      })
    }

    await prisma.$executeRaw`
      UPDATE User SET vlan = ${safeVlan}, updatedAt = CURRENT_TIMESTAMP WHERE id = ${id}
    `
    if (safeRole === 'landlord') {
      await applyProvisioningProfileSelection(id, provisioningProfileId, provisioningProfile)
    }

    return NextResponse.json({ ...updatedUser, vlan: safeVlan, cnpj: hubsoftClient?.cnpj ?? null })
  } catch (error) {
    console.error('User update error:', error)
    const message = (error as Error).message || 'Erro ao atualizar usuário.'
    const status = message.includes('CNPJ') || message.includes('Hubsoft') || message.includes('Perfil') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 })
    }
    if (currentUser.role !== 'admin') {
      return forbidden()
    }

    const { id } = await request.json()
    if (!id) {
      return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 })
    }
    if (id === currentUser.id) {
      return NextResponse.json({ error: 'Você não pode excluir o próprio usuário em sessão.' }, { status: 400 })
    }

    const linkedContracts = await prisma.contract.count({
      where: {
        landlord: {
          userId: id,
        },
      },
    })
    if (linkedContracts > 0) {
      return NextResponse.json({ error: 'Este operador possui contratos vinculados e não pode ser excluído.' }, { status: 400 })
    }

    await prisma.user.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('User delete error:', error)
    return NextResponse.json({ error: 'Erro ao excluir usuário.' }, { status: 500 })
  }
}
