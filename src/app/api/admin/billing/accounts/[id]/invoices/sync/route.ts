import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { syncHubsoftInvoicesForBillingAccount } from '@/lib/billing'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(_request: Request, context: RouteContext<'/api/admin/billing/accounts/[id]/invoices/sync'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { id } = await context.params
  const result = await syncHubsoftInvoicesForBillingAccount(id)
  return NextResponse.json(result)
}
