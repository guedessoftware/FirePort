import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { listAccessControls } from '@/lib/access-control'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  return NextResponse.json(await listAccessControls())
}
