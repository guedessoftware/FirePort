import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getApplicationSettings, saveApplicationSettings } from '@/lib/app-settings'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]/route'

async function getCurrentAdmin() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user?.role === 'admin' ? user : null
}

function forbidden() {
  return NextResponse.json({ error: 'Apenas administradores podem gerenciar os dados da aplicacao.' }, { status: 403 })
}

export async function GET() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    return NextResponse.json(await getApplicationSettings())
  } catch (error) {
    console.error('[APPLICATION SETTINGS] erro ao carregar dados da aplicacao', error)
    return NextResponse.json({ error: 'Erro ao carregar dados da aplicacao.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    const settings = await saveApplicationSettings({
      applicationName: body.applicationName,
      companyName: body.companyName,
      companyLegalName: body.companyLegalName,
      companyLogo: body.companyLogo,
      companyLogoDark: body.companyLogoDark,
      useCompanyLogo: body.useCompanyLogo,
      companyDocument: body.companyDocument,
      supportEmail: body.supportEmail,
      supportPhone: body.supportPhone,
      websiteUrl: body.websiteUrl,
      address: body.address,
      addressPostalCode: body.addressPostalCode,
      city: body.city,
      state: body.state,
      description: body.description,
      viabilityRadiusMeters: body.viabilityRadiusMeters,
    })

    return NextResponse.json(settings)
  } catch (error) {
    console.error('[APPLICATION SETTINGS] erro ao salvar dados da aplicacao', error)
    return NextResponse.json({
      error: (error as Error).message || 'Erro ao salvar dados da aplicacao.',
    }, { status: 400 })
  }
}
