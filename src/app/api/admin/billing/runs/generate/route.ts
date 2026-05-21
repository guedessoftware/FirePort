import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { generateBillingRuns } from '@/lib/billing'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function normalizeYear(value: unknown) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : undefined
}

function normalizeMonth(value: unknown) {
  const month = Number(value)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const body = await request.json().catch(() => ({}))
  const result = await generateBillingRuns({
    year: normalizeYear(body.year),
    month: normalizeMonth(body.month),
  })

  return NextResponse.json({
    cycle: result.cycle,
    runsCreatedOrExisting: result.runs.length,
    runs: result.runs,
  })
}
