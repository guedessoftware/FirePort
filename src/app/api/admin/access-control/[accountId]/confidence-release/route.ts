import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { grantConfidenceRelease } from '@/lib/access-control'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/admin/access-control/[accountId]/confidence-release'>,
) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { accountId } = await context.params
  const body = await request.json().catch(() => ({}))

  try {
    const status = await grantConfidenceRelease({
      billingAccountId: accountId,
      userId: auth.user.id,
      reason: typeof body.reason === 'string' ? body.reason : null,
    })
    return NextResponse.json(status)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Falha ao conceder liberacao em confianca.',
    }, { status: 400 })
  }
}
