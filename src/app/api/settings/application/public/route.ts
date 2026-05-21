import { NextResponse } from 'next/server'
import { getApplicationSettings } from '@/lib/app-settings'

export async function GET() {
  try {
    const settings = await getApplicationSettings()

    return NextResponse.json({
      applicationName: settings.applicationName,
      companyName: settings.companyName,
      companyLogo: settings.companyLogo,
      companyLogoDark: settings.companyLogoDark,
      useCompanyLogo: settings.useCompanyLogo,
      description: settings.description,
      websiteUrl: settings.websiteUrl,
      viabilityRadiusMeters: settings.viabilityRadiusMeters,
    })
  } catch (error) {
    console.error('[PUBLIC APPLICATION SETTINGS] erro ao carregar identidade da aplicacao', error)
    return NextResponse.json({ error: 'Erro ao carregar dados da aplicacao.' }, { status: 500 })
  }
}
