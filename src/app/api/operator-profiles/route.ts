import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireAuthenticated } from '@/lib/api-auth'
import { listOltDrivers } from '@/lib/olt'
import { listOperatorProfiles, upsertOperatorProfile } from '@/lib/operator-profiles'
import { prisma } from '@/lib/prisma'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function validateDriver(driver: string) {
  return listOltDrivers().some((item) => item.id === driver)
}

function numberOrNull(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

export async function GET() {
  try {
    const auth = await requireAuthenticated()
    if (!auth.user) {
      return authError(auth.error ?? 'Sessao invalida ou expirada.', auth.status)
    }

    if (auth.user.role !== 'admin') {
      return NextResponse.json(await listOperatorProfiles(auth.user.id))
    }

    const adminAuth = await requireAdmin()
    if (!adminAuth.user) {
      return authError(adminAuth.error ?? 'Apenas administradores podem gerenciar perfis operacionais.', adminAuth.status)
    }

    return NextResponse.json(await listOperatorProfiles())
  } catch (error) {
    console.error('Operator profile list error:', error)
    return NextResponse.json({ error: 'Erro ao listar perfis operacionais.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticated()
    if (!auth.user) {
      return authError(auth.error ?? 'Sessao invalida ou expirada.', auth.status)
    }

    const isAdmin = auth.user.role === 'admin'
    if (isAdmin) {
      const adminAuth = await requireAdmin()
      if (!adminAuth.user) {
        return authError(adminAuth.error ?? 'Apenas administradores podem gerenciar perfis operacionais.', adminAuth.status)
      }
    }

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const driver = typeof body.driver === 'string' ? body.driver.trim() : ''
    const userId = isAdmin && typeof body.userId === 'string' ? body.userId.trim() : auth.user.id
    const vlan = numberOrNull(body.vlan)
    const serviceVlan = numberOrNull(body.serviceVlan)
    const gemPort = numberOrNull(body.gemPort)
    const tcont = numberOrNull(body.tcont)

    if (!name || !driver || !userId) {
      return NextResponse.json({ error: 'Operador, nome e driver são obrigatórios.' }, { status: 400 })
    }

    if (!validateDriver(driver)) {
      return NextResponse.json({ error: 'Driver OLT inválido.' }, { status: 400 })
    }

    if ([vlan, serviceVlan, gemPort, tcont].some((value) => value === undefined)) {
      return NextResponse.json({ error: 'VLAN, service VLAN, GEM Port e TCONT devem ser numéricos.' }, { status: 400 })
    }

    const user = await prisma.user.findFirst({ where: { id: userId, role: { not: 'admin' } } })
    if (!user) {
      return NextResponse.json({ error: 'Operador não encontrado.' }, { status: 404 })
    }

    const profile = await upsertOperatorProfile({
      userId,
      name,
      driver,
      vlan,
      serviceVlan,
      lineProfile: optionalText(body.lineProfile),
      serviceProfile: optionalText(body.serviceProfile),
      gemPort,
      tcont,
      serviceName: optionalText(body.serviceName),
      isDefault: Boolean(body.isDefault),
    })

    return NextResponse.json(profile, { status: 201 })
  } catch (error) {
    console.error('Operator profile create error:', error)
    return NextResponse.json({ error: 'Erro ao criar perfil operacional.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuthenticated()
    if (!auth.user) {
      return authError(auth.error ?? 'Sessao invalida ou expirada.', auth.status)
    }

    const isAdmin = auth.user.role === 'admin'
    if (isAdmin) {
      const adminAuth = await requireAdmin()
      if (!adminAuth.user) {
        return authError(adminAuth.error ?? 'Apenas administradores podem gerenciar perfis operacionais.', adminAuth.status)
      }
    }

    const body = await request.json()
    const id = typeof body.id === 'string' ? body.id : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const driver = typeof body.driver === 'string' ? body.driver.trim() : ''
    const userId = isAdmin && typeof body.userId === 'string' ? body.userId.trim() : auth.user.id
    const vlan = numberOrNull(body.vlan)
    const serviceVlan = numberOrNull(body.serviceVlan)
    const gemPort = numberOrNull(body.gemPort)
    const tcont = numberOrNull(body.tcont)

    if (!id || !name || !driver || !userId) {
      return NextResponse.json({ error: 'ID, operador, nome e driver são obrigatórios.' }, { status: 400 })
    }

    if (!validateDriver(driver)) {
      return NextResponse.json({ error: 'Driver OLT inválido.' }, { status: 400 })
    }

    if ([vlan, serviceVlan, gemPort, tcont].some((value) => value === undefined)) {
      return NextResponse.json({ error: 'VLAN, service VLAN, GEM Port e TCONT devem ser numéricos.' }, { status: 400 })
    }

    if (!isAdmin) {
      const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId" FROM "ProvisioningProfile" WHERE "id" = ${id} LIMIT 1
      `
      if (!rows[0] || rows[0].userId !== auth.user.id) {
        return NextResponse.json({ error: 'Perfil operacional não encontrado para este operador.' }, { status: 404 })
      }
    }

    const user = await prisma.user.findFirst({ where: { id: userId, role: { not: 'admin' } } })
    if (!user) {
      return NextResponse.json({ error: 'Operador não encontrado.' }, { status: 404 })
    }

    const profile = await upsertOperatorProfile({
      id,
      userId,
      name,
      driver,
      vlan,
      serviceVlan,
      lineProfile: optionalText(body.lineProfile),
      serviceProfile: optionalText(body.serviceProfile),
      gemPort,
      tcont,
      serviceName: optionalText(body.serviceName),
      isDefault: Boolean(body.isDefault),
    })

    return NextResponse.json(profile)
  } catch (error) {
    console.error('Operator profile update error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar perfil operacional.' }, { status: 500 })
  }
}
