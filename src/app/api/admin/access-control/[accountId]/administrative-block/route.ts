import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { setAdministrativeBlock } from '@/lib/access-control'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/admin/access-control/[accountId]/administrative-block'>,
) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { accountId } = await context.params
  const body = await request.json().catch(() => ({}))
  const active = body.active !== false
  const reason = typeof body.reason === 'string' ? body.reason : null
  const details = typeof body.details === 'string' ? body.details : null

  try {
    const status = await setAdministrativeBlock({
      billingAccountId: accountId,
      active,
      reason,
      details,
      userId: auth.user.id,
    })
    return NextResponse.json(status)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Falha ao alterar bloqueio administrativo.',
    }, { status: 400 })
  }
}
