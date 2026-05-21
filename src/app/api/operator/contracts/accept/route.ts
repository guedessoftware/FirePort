import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/api-auth'
import { acceptContractVersion, getContractRequirementForUser } from '@/lib/contracts'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessao invalida ou expirada. Faca login novamente.',
  }, { status: 401 })
}

function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  try {
    const body = await request.json()
    const status = await getContractRequirementForUser(user.id)
    if (!status.required || !status.version) {
      return NextResponse.json({ error: 'Nao ha contrato pendente para aceite.' }, { status: 400 })
    }
    if (status.accepted) {
      return NextResponse.json({ error: 'Contrato vigente ja aceito.' }, { status: 400 })
    }
    if (body.versionId !== status.version.id) {
      return NextResponse.json({ error: 'Versao de contrato divergente. Atualize a pagina.' }, { status: 409 })
    }

    const result = await acceptContractVersion({
      userId: user.id,
      versionId: status.version.id,
      otpId: typeof body.otpId === 'string' ? body.otpId : '',
      code: typeof body.code === 'string' ? body.code : '',
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Falha ao registrar aceite.',
    }, { status: 400 })
  }
}
