import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getErpAdapter } from '@/lib/erp/adapters'
import {
  getErpConfigPublic,
  getErpConfigSecret,
  getLandlordForUser,
  isErpProvider,
  normalizeLookupKeys,
  sanitizeErpBaseUrl,
  setErpConfigTestStatus,
  upsertErpConfig,
} from '@/lib/erp/config'
import { getActiveErpConfigSecret } from '@/lib/erp/config'
import type { ErpProvider, OperatorErpConfigSecret } from '@/lib/erp/types'

async function currentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return null
  return prisma.user.findUnique({ where: { id: userId } })
}

export async function GET() {
  try {
    const user = await currentUser()
    if (!user) return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    if (user.role === 'admin') return NextResponse.json({ config: null })

    const landlord = await getLandlordForUser(user.id, user.name)
    const config = await getErpConfigPublic(landlord.id)
    return NextResponse.json({ config })
  } catch (error) {
    console.error('ERP config read error:', error)
    return NextResponse.json({ error: 'Erro ao carregar configuracao ERP.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await currentUser()
    if (!user) return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    if (user.role === 'admin') return NextResponse.json({ error: 'Use uma conta de operador para configurar ERP.' }, { status: 403 })

    const body = await request.json()
    if (!isErpProvider(body.provider)) {
      return NextResponse.json({ error: 'ERP selecionado invalido.' }, { status: 400 })
    }

    const rawBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
    if (!rawBaseUrl) {
      return NextResponse.json({ error: 'Informe a URL base do ERP.' }, { status: 400 })
    }
    let baseUrl: string
    try {
      baseUrl = sanitizeErpBaseUrl(body.provider, rawBaseUrl)
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message || 'URL base do ERP invalida.' }, { status: 400 })
    }

    const landlord = await getLandlordForUser(user.id, user.name)
    const config = await upsertErpConfig({
      landlordId: landlord.id,
      provider: body.provider,
      baseUrl,
      enabled: Boolean(body.enabled),
      allowedLookupKeys: normalizeLookupKeys(body.allowedLookupKeys, body.provider),
      token: typeof body.token === 'string' ? body.token : null,
      username: typeof body.username === 'string' ? body.username : null,
      password: typeof body.password === 'string' ? body.password : null,
      clientId: typeof body.clientId === 'string' ? body.clientId : null,
      clientSecret: typeof body.clientSecret === 'string' ? body.clientSecret : null,
    })

    return NextResponse.json({ config })
  } catch (error) {
    console.error('ERP config update error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Erro ao salvar configuracao ERP.' }, { status: 500 })
  }
}

function recordFrom(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function textInput(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function draftConfigFromBody(
  body: Record<string, unknown>,
  landlordId: string,
  savedConfig: OperatorErpConfigSecret | null,
): OperatorErpConfigSecret | Response {
  if (!isErpProvider(body.provider)) {
    return NextResponse.json({ error: 'ERP selecionado invalido.' }, { status: 400 })
  }

  const provider = body.provider as ErpProvider
  const rawBaseUrl = textInput(body.baseUrl)
  if (!rawBaseUrl) {
    return NextResponse.json({ error: 'Informe a URL base do ERP.' }, { status: 400 })
  }

  const sameProvider = savedConfig?.provider === provider
  let baseUrl: string
  try {
    baseUrl = sanitizeErpBaseUrl(provider, rawBaseUrl)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'URL base do ERP invalida.' }, { status: 400 })
  }

  return {
    id: savedConfig?.id ?? 'draft',
    landlordId,
    provider,
    baseUrl,
    enabled: Boolean(body.enabled),
    allowedLookupKeys: normalizeLookupKeys(body.allowedLookupKeys, provider),
    token: textInput(body.token) ?? (sameProvider ? savedConfig?.token ?? null : null),
    username: textInput(body.username) ?? (sameProvider ? savedConfig?.username ?? null : null),
    password: typeof body.password === 'string' && body.password ? body.password : sameProvider ? savedConfig?.password ?? null : null,
    clientId: textInput(body.clientId) ?? (sameProvider ? savedConfig?.clientId ?? null : null),
    clientSecret: typeof body.clientSecret === 'string' && body.clientSecret ? body.clientSecret : sameProvider ? savedConfig?.clientSecret ?? null : null,
    extra: sameProvider ? savedConfig?.extra ?? null : null,
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser()
    if (!user) return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    if (user.role === 'admin') return NextResponse.json({ error: 'Use uma conta de operador para testar ERP.' }, { status: 403 })

    const landlord = await getLandlordForUser(user.id, user.name)
    const body = recordFrom(await request.json().catch(() => null))
    const savedConfig = body ? await getErpConfigSecret(landlord.id) : null
    const config = body
      ? draftConfigFromBody(body, landlord.id, savedConfig)
      : await getActiveErpConfigSecret(landlord.id)

    if (config instanceof Response) return config
    if (!config) return NextResponse.json({ error: 'Configure e ative o ERP antes de testar.' }, { status: 400 })

    try {
      await getErpAdapter(config.provider).test(config)
      if (!body) {
        await setErpConfigTestStatus(config.id, true)
        return NextResponse.json({ ok: true, config: await getErpConfigPublic(landlord.id) })
      }
      return NextResponse.json({ ok: true })
    } catch (error) {
      const message = (error as Error).message || 'Falha ao testar ERP.'
      if (!body) {
        await setErpConfigTestStatus(config.id, false, message)
        return NextResponse.json({ ok: false, error: message, config: await getErpConfigPublic(landlord.id) }, { status: 400 })
      }
      return NextResponse.json({ ok: false, error: message }, { status: 400 })
    }
  } catch (error) {
    console.error('ERP config test error:', error)
    return NextResponse.json({ error: 'Erro ao testar configuracao ERP.' }, { status: 500 })
  }
}
