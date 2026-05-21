import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { listContractTemplates, publishContractTemplate } from '@/lib/contracts'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  return NextResponse.json(await listContractTemplates())
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  try {
    const body = await request.json()
    const result = await publishContractTemplate({
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : null,
      bodyText: typeof body.bodyText === 'string' ? body.bodyText : '',
      createdByUserId: auth.user.id,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Falha ao publicar contrato.',
    }, { status: 400 })
  }
}
