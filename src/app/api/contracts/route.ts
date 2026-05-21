import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { assertPortalMutationAllowed } from '@/lib/access-control'
import { normalizeErpLinkInput, upsertErpLink } from '@/lib/erp/links'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error) {
    return error
  }

  return fallback
}

function unauthorized(message = 'Sessão inválida ou expirada. Faça login novamente.') {
  return NextResponse.json({ error: 'Unauthorized', message }, { status: 401 })
}

function cleanOptionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

async function updateContractPppoeCredentials(contractId: string, pppoeLogin: string | null, pppoePassword: string | null) {
  await prisma.$executeRaw`
    UPDATE "Contract"
    SET "pppoeLogin" = ${pppoeLogin}, "pppoePassword" = ${pppoePassword}
    WHERE "id" = ${contractId}
  `
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return unauthorized()
    }

    const userEmail = session.user?.email
    if (!userEmail) {
      return unauthorized('Sessão sem email de usuário. Faça login novamente.')
    }

    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    })

    if (!user) {
      return unauthorized('Usuário da sessão não existe mais no banco. Faça login novamente ou cadastre o parceiro.')
    }

    const contracts = await prisma.contract.findMany({
      where: user.role === 'admin'
        ? undefined
        : { landlord: { userId: user.id } },
      include: {
        landlord: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
      },
    })

    return NextResponse.json(contracts)
  } catch (error: unknown) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let session
  try {
    session = await getServerSession(authOptions)
  } catch (sessionError) {
    console.error('Session error:', sessionError)
    return NextResponse.json({ error: 'Auth error', details: String(sessionError) }, { status: 500 })
  }
  
  if (!session) {
    return unauthorized()
  }

  const userEmail = session.user?.email
  if (!userEmail) {
    return unauthorized('Sessão sem email de usuário. Faça login novamente.')
  }

  let user
  try {
    user = await prisma.user.findUnique({
      where: { email: userEmail },
    })
  } catch (dbError) {
    console.error('User find error:', dbError)
    return NextResponse.json({ error: 'Database error', details: String(dbError) }, { status: 500 })
  }

  if (!user) {
    return unauthorized('Usuário da sessão não existe mais no banco. Faça login novamente ou cadastre o parceiro.')
  }

  if (user.role !== 'admin') {
    try {
      await assertPortalMutationAllowed(user.id, 'change_data')
    } catch (error) {
      return NextResponse.json({
        error: 'Acesso bloqueado.',
        message: error instanceof Error ? error.message : 'Seu acesso nao permite alterar dados no momento.',
      }, { status: 403 })
    }
  }

  let landlord
  try {
    landlord = await prisma.landlord.findUnique({
      where: { userId: user.id },
    })
  } catch (dbError) {
    console.error('Landlord find error:', dbError)
    return NextResponse.json({ error: 'Database error', details: String(dbError) }, { status: 500 })
  }

  if (!landlord) {
    landlord = await prisma.landlord.create({
      data: {
        name: user.name || user.email,
        userId: user.id,
      },
    })
  }

  let body
  try {
    body = await request.json()
  } catch (parseError) {
    console.error('JSON parse error:', parseError)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { name, contractNumber, cep, address, number, complement, reference, lat, lng } = body
  const pppoeLogin = cleanOptionalText(body.pppoeLogin)
  const pppoePassword = cleanOptionalText(body.pppoePassword)
  const erpLink = normalizeErpLinkInput(body.erpLink)
  if (!name || !contractNumber || !cep || !address || !number || lat === undefined || lng === undefined) {
    return NextResponse.json({
      error: 'Missing required fields',
      message: 'Preencha nome, número do contrato, CEP, endereço, número e localização.',
    }, { status: 400 })
  }

  const cleanedCep = String(cep).replace(/\D/g, "")
  if (cleanedCep.length !== 8) {
    return NextResponse.json({ error: 'CEP inválido. Informe 8 dígitos.' }, { status: 400 })
  }

  const parsedLat = Number.parseFloat(String(lat))
  const parsedLng = Number.parseFloat(String(lng))
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return NextResponse.json({
      error: 'Localização inválida.',
      message: 'Busque o endereço novamente antes de criar o contrato.',
    }, { status: 400 })
  }

  const cleanedContractNumber = String(contractNumber).trim()
  const existingContract = await prisma.contract.findFirst({
    where: { contractNumber: cleanedContractNumber, landlordId: landlord.id },
    include: { landlord: true },
  })

  if (existingContract) {
    const shouldUpdatePppoeLogin = Object.prototype.hasOwnProperty.call(body, 'pppoeLogin')
    const shouldUpdatePppoePassword = Object.prototype.hasOwnProperty.call(body, 'pppoePassword')
    if (shouldUpdatePppoeLogin || shouldUpdatePppoePassword) {
      await updateContractPppoeCredentials(
        existingContract.id,
        shouldUpdatePppoeLogin ? pppoeLogin : null,
        shouldUpdatePppoePassword ? pppoePassword : null,
      )
    }
    await upsertErpLink(landlord.id, existingContract.id, erpLink)
    return NextResponse.json(existingContract)
  }

  let contract
  try {
    contract = await prisma.contract.create({
      data: {
        name: String(name).trim(),
        contractNumber: cleanedContractNumber,
        cep: cleanedCep,
        address: String(address).trim(),
        number: String(number).trim(),
        complement: complement ? String(complement).trim() : null,
        reference: reference ? String(reference).trim() : null,
        lat: parsedLat,
        lng: parsedLng,
        landlordId: landlord.id,
      },
    })
  } catch (dbError) {
    console.error('Contract create error:', dbError)
    return NextResponse.json({
      error: 'Failed to create contract',
      message: errorMessage(dbError, 'Falha ao criar contrato.'),
      details: String(dbError),
    }, { status: 500 })
  }

  await updateContractPppoeCredentials(contract.id, pppoeLogin, pppoePassword)
  await upsertErpLink(landlord.id, contract.id, erpLink)

  return NextResponse.json(contract)
}
