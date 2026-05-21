import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getGenieAcsSettingsPublic, saveGenieAcsSettings, testGenieAcsConnection } from '@/lib/genieacs'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  return NextResponse.json(await getGenieAcsSettingsPublic())
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const settings = await saveGenieAcsSettings({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      authHeaderName: typeof body.authHeaderName === 'string' ? body.authHeaderName : undefined,
      authHeaderValue: typeof body.authHeaderValue === 'string' ? body.authHeaderValue : undefined,
      serialParameter: typeof body.serialParameter === 'string' ? body.serialParameter : undefined,
      wifiSsidParameter: typeof body.wifiSsidParameter === 'string' ? body.wifiSsidParameter : undefined,
      wifiPasswordParameter: typeof body.wifiPasswordParameter === 'string' ? body.wifiPasswordParameter : undefined,
      wifi5SsidParameter: typeof body.wifi5SsidParameter === 'string' ? body.wifi5SsidParameter : undefined,
      wifi5PasswordParameter: typeof body.wifi5PasswordParameter === 'string' ? body.wifi5PasswordParameter : undefined,
      hostsObjectPath: typeof body.hostsObjectPath === 'string' ? body.hostsObjectPath : undefined,
      connectionRequest: typeof body.connectionRequest === 'boolean' ? body.connectionRequest : undefined,
      connectionRequestTimeoutMs: body.connectionRequestTimeoutMs === undefined ? undefined : Number(body.connectionRequestTimeoutMs),
      provisioningWaitSeconds: body.provisioningWaitSeconds === undefined ? undefined : Number(body.provisioningWaitSeconds),
    })
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[GENIEACS SETTINGS] erro ao salvar', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao salvar GenieACS.' }, { status: 400 })
  }
}

export async function POST() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const settings = await testGenieAcsConnection()
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: (error as Error).message || 'Falha ao testar GenieACS.',
      settings: await getGenieAcsSettingsPublic(),
    })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    await saveGenieAcsSettings({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      authHeaderName: typeof body.authHeaderName === 'string' ? body.authHeaderName : undefined,
      authHeaderValue: typeof body.authHeaderValue === 'string' ? body.authHeaderValue : undefined,
      serialParameter: typeof body.serialParameter === 'string' ? body.serialParameter : undefined,
      wifiSsidParameter: typeof body.wifiSsidParameter === 'string' ? body.wifiSsidParameter : undefined,
      wifiPasswordParameter: typeof body.wifiPasswordParameter === 'string' ? body.wifiPasswordParameter : undefined,
      wifi5SsidParameter: typeof body.wifi5SsidParameter === 'string' ? body.wifi5SsidParameter : undefined,
      wifi5PasswordParameter: typeof body.wifi5PasswordParameter === 'string' ? body.wifi5PasswordParameter : undefined,
      hostsObjectPath: typeof body.hostsObjectPath === 'string' ? body.hostsObjectPath : undefined,
      connectionRequest: typeof body.connectionRequest === 'boolean' ? body.connectionRequest : undefined,
      connectionRequestTimeoutMs: body.connectionRequestTimeoutMs === undefined ? undefined : Number(body.connectionRequestTimeoutMs),
      provisioningWaitSeconds: body.provisioningWaitSeconds === undefined ? undefined : Number(body.provisioningWaitSeconds),
    })
    const settings = await testGenieAcsConnection()
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: (error as Error).message || 'Falha ao testar GenieACS.',
      settings: await getGenieAcsSettingsPublic(),
    })
  }
}
