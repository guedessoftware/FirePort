import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireAuthenticated } from '@/lib/api-auth'
import { listCpeModelOltProfiles, upsertCpeModelOltProfile } from '@/lib/cpe-model-olt-profiles'
import { prisma } from '@/lib/prisma'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  const clean = cleanText(value)
  return clean || null
}

function cleanCommands(value: unknown) {
  const clean = cleanText(value)
  return clean || null
}

function validateJsonObjectOrArray(value: unknown, label: string) {
  const clean = optionalText(value)
  if (!clean) return null

  try {
    JSON.parse(clean)
    return clean
  } catch {
    throw new Error(`${label} deve estar em JSON valido.`)
  }
}

async function serializeCpeModel(model: {
  id: string
  name: string
  description: string | null
  _count?: { provisionings: number }
}, includeOltProfiles = false) {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    provisioningCount: model._count?.provisionings ?? 0,
    ...(includeOltProfiles ? { oltProfiles: await listCpeModelOltProfiles(model.id) } : {}),
  }
}

export async function GET() {
  try {
    const auth = await requireAuthenticated()
    if (!auth.user) {
      return authError(auth.error ?? 'Nao autorizado.', auth.status)
    }

    const cpeModels = await prisma.cPEModel.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { provisionings: true } },
      },
    })
    let includeOltProfiles = false
    if (auth.user.role === 'admin') {
      const adminAuth = await requireAdmin()
      if (!adminAuth.user) {
        return authError(adminAuth.error ?? 'Nao autorizado.', adminAuth.status)
      }
      includeOltProfiles = true
    }
    return NextResponse.json(await Promise.all(cpeModels.map((model) => serializeCpeModel(model, includeOltProfiles))))
  } catch (error: unknown) {
    console.error('CPE models fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch CPE models' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return authError(auth.error ?? 'Nao autorizado.', auth.status)
    }

    const body = await request.json()
    const name = cleanText(body.name)
    const description = optionalText(body.description)
    const oltProfiles = Array.isArray(body.oltProfiles) ? body.oltProfiles : []

    if (!name) {
      return NextResponse.json({ error: 'Informe o nome do modelo de ONU.' }, { status: 400 })
    }

    const cpeModel = await prisma.cPEModel.create({
      data: {
        name,
        description,
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    })
    for (const profile of oltProfiles) {
      await upsertCpeModelOltProfile({
        cpeModelId: cpeModel.id,
        oltManufacturer: cleanText(profile.oltManufacturer),
        oltModel: cleanText(profile.oltModel),
        oltDriver: cleanText(profile.oltDriver),
        onuType: optionalText(profile.onuType),
        authorizationCommands: cleanCommands(profile.authorizationCommands),
        provisioningCommands: cleanCommands(profile.provisioningCommands),
        deprovisioningCommands: cleanCommands(profile.deprovisioningCommands),
        deauthorizationCommands: cleanCommands(profile.deauthorizationCommands),
        tr069Commands: cleanCommands(profile.tr069Commands),
        genieAcsParameterMapJson: validateJsonObjectOrArray(profile.genieAcsParameterMapJson, 'Mapa GenieACS'),
        requiredVariablesJson: validateJsonObjectOrArray(profile.requiredVariablesJson, 'Variaveis obrigatorias'),
      })
    }

    return NextResponse.json(await serializeCpeModel({ ...cpeModel, _count: { provisionings: 0 } }, true), { status: 201 })
  } catch (error: unknown) {
    console.error('CPE model create error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Failed to create CPE model' }, { status: 500 })
  }
}
