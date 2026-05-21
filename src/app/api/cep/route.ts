import { NextRequest, NextResponse } from 'next/server'
import { requireAuthenticated } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const cep = searchParams.get('cep')?.replace(/\D/g, '')

  if (!cep || cep.length !== 8) {
    return NextResponse.json({ error: 'CEP inválido. Informe 8 dígitos.' }, { status: 400 })
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
    if (!response.ok) {
      return NextResponse.json({ error: 'Não foi possível buscar o CEP.' }, { status: 500 })
    }

    const data = await response.json()
    if (data.erro) {
      return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error: unknown) {
    console.error(error)
    return NextResponse.json({ error: 'Erro ao buscar CEP.' }, { status: 500 })
  }
}
