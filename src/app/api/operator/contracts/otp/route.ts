import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/api-auth'
import { createContractAcceptanceOtp, getContractRequirementForUser } from '@/lib/contracts'

function unauthorized() {
  return NextResponse.json({
    error: 'Unauthorized',
    message: 'Sessao invalida ou expirada. Faca login novamente.',
  }, { status: 401 })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  try {
    const body = await request.json().catch(() => ({}))
    const status = await getContractRequirementForUser(user.id)
    const requestedVersionId = typeof body.versionId === 'string' ? body.versionId : null
    if (!status.required || !status.version) {
      return NextResponse.json({ error: 'Nao ha contrato pendente para aceite.' }, { status: 400 })
    }
    if (status.accepted) {
      return NextResponse.json({ error: 'Contrato vigente ja aceito.' }, { status: 400 })
    }
    if (requestedVersionId && requestedVersionId !== status.version.id) {
      return NextResponse.json({ error: 'Versao de contrato divergente. Atualize a pagina.' }, { status: 409 })
    }

    const otp = await createContractAcceptanceOtp({ userId: user.id, versionId: status.version.id })

    return NextResponse.json({
      sent: true,
      otpId: otp.id,
      destination: otp.destination,
      expiresAt: otp.expiresAt,
      message: `Codigo enviado para ${otp.destination}.`,
    })
  } catch (error) {
    return NextResponse.json({
      sent: false,
      error: error instanceof Error ? error.message : 'Falha ao enviar codigo por email.',
    })
  }
}
