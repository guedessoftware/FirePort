import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/api-auth'
import { getContractRequirementForUser } from '@/lib/contracts'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessao invalida ou expirada. Faca login novamente.',
  }, { status: 401 })
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  return NextResponse.json(await getContractRequirementForUser(user.id))
}
