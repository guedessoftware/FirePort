import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { publishNewContractVersion } from '@/lib/contracts'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: NextRequest, context: RouteContext<'/api/admin/contracts/[templateId]/versions'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  try {
    const { templateId } = await context.params
    const body = await request.json()
    const result = await publishNewContractVersion({
      templateId,
      title: typeof body.title === 'string' ? body.title : '',
      bodyText: typeof body.bodyText === 'string' ? body.bodyText : '',
      publishedByUserId: auth.user.id,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Falha ao publicar nova versao.',
    }, { status: 400 })
  }
}
