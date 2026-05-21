import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { resolveBillingAlert } from '@/lib/billing'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(_request: Request, context: RouteContext<'/api/admin/billing/alerts/[id]/resolve'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { id } = await context.params
  const alert = await resolveBillingAlert(id, auth.user.id)

  if (!alert) {
    return NextResponse.json({ error: 'Alerta financeiro nao encontrado.' }, { status: 404 })
  }

  return NextResponse.json(alert)
}
