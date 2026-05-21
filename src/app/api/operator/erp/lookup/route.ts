import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getErpAdapter } from '@/lib/erp/adapters'
import { erpLookupKeys, getActiveErpConfigSecret, getLandlordForUser, isLookupKeyCompatible } from '@/lib/erp/config'
import type { ErpLookupKey } from '@/lib/erp/types'

async function currentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return null
  return prisma.user.findUnique({ where: { id: userId } })
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser()
    if (!user) return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    if (user.role === 'admin') return NextResponse.json({ error: 'Consulta ERP disponivel apenas para operador.' }, { status: 403 })

    const body = await request.json()
    const key = body.key as ErpLookupKey
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!erpLookupKeys.includes(key)) {
      return NextResponse.json({ error: 'Tipo de busca invalido.' }, { status: 400 })
    }
    if (!query) {
      return NextResponse.json({ error: 'Informe o valor da busca.' }, { status: 400 })
    }

    const landlord = await getLandlordForUser(user.id, user.name)
    const config = await getActiveErpConfigSecret(landlord.id)
    if (!config) {
      return NextResponse.json({ error: 'Este operador nao possui ERP ativo.' }, { status: 404 })
    }
    if (!config.allowedLookupKeys.includes(key)) {
      return NextResponse.json({ error: 'Este tipo de busca nao esta habilitado para o ERP do operador.' }, { status: 400 })
    }
    if (!isLookupKeyCompatible(config.provider, key)) {
      return NextResponse.json({ error: 'Este tipo de busca nao e compativel com o ERP selecionado.' }, { status: 400 })
    }

    const result = await getErpAdapter(config.provider).lookup(config, { key, query })
    return NextResponse.json(result)
  } catch (error) {
    console.error('ERP lookup error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao consultar ERP.' }, { status: 500 })
  }
}
