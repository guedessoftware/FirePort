import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { updateBillingAccount } from '@/lib/billing'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function PATCH(request: NextRequest, context: RouteContext<'/api/admin/billing/accounts/[id]'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { id } = await context.params
  const body = await request.json()
  const account = await updateBillingAccount(id, body)
  if (!account) {
    return NextResponse.json({ error: 'Conta financeira nao encontrada.' }, { status: 404 })
  }

  return NextResponse.json(account)
}
