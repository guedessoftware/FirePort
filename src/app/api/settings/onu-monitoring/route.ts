import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getOnuMonitoringSettings, saveOnuMonitoringSettings } from '@/lib/app-settings'
import { OnuMonitorAlreadyRunningError, runOnuTelemetryMonitorNow, syncOnuTelemetryMonitorJob } from '@/lib/onu-monitoring'
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
  return NextResponse.json({ error: 'Apenas administradores podem gerenciar o monitoramento.' }, { status: 403 })
}

export async function GET() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    return NextResponse.json(await getOnuMonitoringSettings())
  } catch (error) {
    console.error('[ONU MONITOR SETTINGS] erro ao carregar configuracao', error)
    return NextResponse.json({ error: 'Erro ao carregar configuração de monitoramento.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const body = await request.json()
    const settings = await saveOnuMonitoringSettings({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      intervalMinutes: body.intervalMinutes === undefined ? undefined : Number(body.intervalMinutes),
    })

    await syncOnuTelemetryMonitorJob({ runImmediately: true })
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[ONU MONITOR SETTINGS] erro ao salvar configuracao', error)
    return NextResponse.json({
      error: (error as Error).message || 'Erro ao salvar configuração de monitoramento.',
    }, { status: 400 })
  }
}

export async function POST() {
  try {
    const currentUser = await getCurrentAdmin()
    if (!currentUser) {
      return forbidden()
    }

    const result = await runOnuTelemetryMonitorNow()
    return NextResponse.json({
      ok: !result.error,
      message: `Monitoramento executado. ${result.success} ONUs coletadas, ${result.failed} falhas.`,
      ...result,
      settings: await getOnuMonitoringSettings(),
    }, { status: result.error ? 500 : 200 })
  } catch (error) {
    if (error instanceof OnuMonitorAlreadyRunningError) {
      return NextResponse.json({
        ok: false,
        code: 'monitor_running',
        message: error.message,
        settings: await getOnuMonitoringSettings(),
      }, { status: 409 })
    }

    console.error('[ONU MONITOR SETTINGS] erro ao executar monitoramento manual', error)
    return NextResponse.json({
      success: false,
      error: (error as Error).message || 'Erro ao executar monitoramento.',
    }, { status: 500 })
  }
}
