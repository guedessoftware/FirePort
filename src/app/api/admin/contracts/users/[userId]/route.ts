import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getUserContractAcceptanceView } from '@/lib/contracts'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET(_request: Request, context: RouteContext<'/api/admin/contracts/users/[userId]'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { userId } = await context.params
  return NextResponse.json(await getUserContractAcceptanceView(userId))
}
