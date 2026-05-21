import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getUserAcceptedContractPdf } from '@/lib/contracts'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET(_request: Request, context: RouteContext<'/api/admin/contracts/users/[userId]/pdf'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { userId } = await context.params
  const pdf = await getUserAcceptedContractPdf(userId)
  if (!pdf) {
    return NextResponse.json({ error: 'Aceite de contrato pendente.' }, { status: 404 })
  }

  return new NextResponse(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="contrato-aceito-${userId}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
