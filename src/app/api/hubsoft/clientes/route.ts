import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { isValidCnpj, normalizeCnpj } from '@/lib/cnpj'
import { fetchHubsoftClientByCnpj } from '@/lib/hubsoft'

function authError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return authError(auth.error ?? 'Nao autorizado.', auth.status)
    }

    const cnpj = normalizeCnpj(request.nextUrl.searchParams.get('cnpj'))
    if (!cnpj || !isValidCnpj(cnpj)) {
      return NextResponse.json({ error: 'Informe um CNPJ valido com 14 digitos.' }, { status: 400 })
    }

    const client = await fetchHubsoftClientByCnpj(cnpj)
    if (!client) {
      return NextResponse.json({ error: 'Cliente nao encontrado no Hubsoft para este CNPJ.' }, { status: 404 })
    }

    if (client.personType !== 'pj') {
      return NextResponse.json({ error: 'O cadastro do operador aceita somente clientes PJ/CNPJ.' }, { status: 400 })
    }

    return NextResponse.json(client)
  } catch (error) {
    console.error('Hubsoft client lookup error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao consultar cliente Hubsoft.' }, { status: 500 })
  }
}
