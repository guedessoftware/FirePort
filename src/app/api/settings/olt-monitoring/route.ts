import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getOltMonitoringSettings, saveOltMonitoringSettings } from '@/lib/app-settings'
import { OltMonitorAlreadyRunningError, runOltTelemetryMonitorNow, syncOltTelemetryMonitorJob } from '@/lib/olt-monitoring'
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
  return NextResponse.json({ error: 'Apenas administradores podem gerenciar o monitoramento de OLT.' }, { status: 403 })
}

export async function GET() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    return NextResponse.json(await getOltMonitoringSettings())
  } catch (error) {
    console.error('[OLT MONITOR SETTINGS] erro ao carregar configuracao', error)
    return NextResponse.json({ error: 'Erro ao carregar configuração de monitoramento da OLT.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    const settings = await saveOltMonitoringSettings({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      intervalMinutes: body.intervalMinutes === undefined ? undefined : Number(body.intervalMinutes),
      trafficIntervalSeconds: body.trafficIntervalSeconds === undefined ? undefined : Number(body.trafficIntervalSeconds),
    })

    await syncOltTelemetryMonitorJob({ runImmediately: true })
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[OLT MONITOR SETTINGS] erro ao salvar configuracao', error)
    return NextResponse.json({
      error: (error as Error).message || 'Erro ao salvar configuração de monitoramento da OLT.',
    }, { status: 400 })
  }
}

export async function POST() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const result = await runOltTelemetryMonitorNow()
    return NextResponse.json({
      ok: !result.error,
      message: `Monitoramento de OLT executado. ${result.success} OLTs coletadas, ${result.failed} falhas.`,
      ...result,
      settings: await getOltMonitoringSettings(),
    }, { status: result.error ? 500 : 200 })
  } catch (error) {
    if (error instanceof OltMonitorAlreadyRunningError) {
      return NextResponse.json({
        ok: false,
        code: 'monitor_running',
        message: error.message,
        settings: await getOltMonitoringSettings(),
      }, { status: 409 })
    }

    console.error('[OLT MONITOR SETTINGS] erro ao executar monitoramento manual', error)
    return NextResponse.json({
      success: false,
      error: (error as Error).message || 'Erro ao executar monitoramento da OLT.',
    }, { status: 500 })
  }
}
