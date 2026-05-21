import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/api-auth'
import { listOperatorBillingInvoices } from '@/lib/billing'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
  }

  return NextResponse.json(await listOperatorBillingInvoices(user.id))
}
