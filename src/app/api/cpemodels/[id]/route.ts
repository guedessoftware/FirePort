import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import {
  deleteCpeModelOltProfile,
  listCpeModelOltProfiles,
  upsertCpeModelOltProfile,
} from '@/lib/cpe-model-olt-profiles'
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
}) {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    provisioningCount: model._count?.provisionings ?? 0,
    oltProfiles: await listCpeModelOltProfiles(model.id),
  }
}

export async function PATCH(request: NextRequest, context: RouteContext<'/api/cpemodels/[id]'>) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return authError(auth.error ?? 'Nao autorizado.', auth.status)
    }

    const { id } = await context.params
    const body = await request.json()
    const name = cleanText(body.name)
    const description = optionalText(body.description)
    const shouldSyncOltProfiles = Array.isArray(body.oltProfiles)
    const oltProfiles = shouldSyncOltProfiles ? body.oltProfiles : []

    if (!name) {
      return NextResponse.json({ error: 'Informe o nome do modelo de ONU.' }, { status: 400 })
    }

    const cpeModel = await prisma.cPEModel.update({
      where: { id },
      data: { name, description },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { provisionings: true } },
      },
    })

    if (shouldSyncOltProfiles) {
      const existingProfiles = await listCpeModelOltProfiles(id)
      const keptProfileIds = new Set<string>()
      for (const profile of oltProfiles) {
        const profileId = cleanText(profile.id)
        const saved = await upsertCpeModelOltProfile({
          id: profileId || undefined,
          cpeModelId: id,
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
        if (saved?.id) keptProfileIds.add(saved.id)
      }

      for (const profile of existingProfiles) {
        if (!keptProfileIds.has(profile.id)) {
          await deleteCpeModelOltProfile(profile.id, id)
        }
      }
    }

    return NextResponse.json(await serializeCpeModel(cpeModel))
  } catch (error) {
    console.error('CPE model update error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao atualizar modelo de ONU.' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<'/api/cpemodels/[id]'>) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return authError(auth.error ?? 'Nao autorizado.', auth.status)
    }

    const { id } = await context.params
    const usage = await prisma.provisioning.count({ where: { cpeModelId: id } })
    if (usage > 0) {
      return NextResponse.json({ error: 'Este modelo esta em uso e nao pode ser excluido.' }, { status: 409 })
    }

    await prisma.cPEModel.delete({ where: { id }, select: { id: true } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('CPE model delete error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao excluir modelo de ONU.' }, { status: 500 })
  }
}
