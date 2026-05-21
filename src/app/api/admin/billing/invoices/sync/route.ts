import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { syncAllHubsoftInvoices } from '@/lib/billing'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const result = await syncAllHubsoftInvoices()
  return NextResponse.json(result)
}
