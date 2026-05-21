import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/api-auth'
import { syncHubsoftInvoicesForOperator } from '@/lib/billing'

export async function POST() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
  }

  const result = await syncHubsoftInvoicesForOperator(user.id)
  return NextResponse.json(result)
}
