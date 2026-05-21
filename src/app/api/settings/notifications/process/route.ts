import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { runNotificationQueueManually } from '@/lib/cron'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  return NextResponse.json(await runNotificationQueueManually())
}
