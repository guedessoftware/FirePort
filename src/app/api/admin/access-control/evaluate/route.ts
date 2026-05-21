import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { runAccessControlManually } from '@/lib/cron'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const body = await request.json().catch(() => ({}))
  const result = await runAccessControlManually({
    userId: auth.user.id,
    syncHubsoft: body.syncHubsoft !== false,
    sendNotifications: body.sendNotifications === true,
  })

  return NextResponse.json(result)
}
