import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getAcceptanceEvidenceHtml } from '@/lib/contracts'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET(_request: Request, context: RouteContext<'/api/admin/contracts/acceptances/[id]/evidence'>) {
  const auth = await requireAdmin()
  if (!auth.user) {
    return authError(auth.error ?? 'Nao autorizado.', auth.status)
  }

  const { id } = await context.params
  const html = await getAcceptanceEvidenceHtml(id)
  if (!html) {
    return NextResponse.json({ error: 'Aceite nao encontrado.' }, { status: 404 })
  }

  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="dossie-aceite-${id}.html"`,
    },
  })
}
