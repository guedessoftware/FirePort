import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { createPenalty, listBillingPenalties } from '@/lib/billing'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  return NextResponse.json(await listBillingPenalties())
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  try {
    const body = await request.json()
    const penalty = await createPenalty({
      billingAccountId: body.billingAccountId,
      amountCents: body.amountCents,
      reason: body.reason,
      evidence: body.evidence,
      userId: auth.user.id,
    })

    return NextResponse.json(penalty, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao criar multa.',
    }, { status: 400 })
  }
}
