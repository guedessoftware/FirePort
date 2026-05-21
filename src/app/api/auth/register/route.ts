import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { timingSafeEqual } from 'crypto'
import { getPasswordPolicyError, hashPassword, isValidEmail, normalizeEmail } from '@/lib/auth-security'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function tokenMatches(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

export async function GET() {
  try {
    const userCount = await prisma.user.count()
    return NextResponse.json({ canCreateInitialAdmin: userCount === 0 })
  } catch (error) {
    console.error('[INITIAL ADMIN STATUS] erro ao verificar cadastro inicial', error)
    return NextResponse.json({ canCreateInitialAdmin: false }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = normalizeEmail(text(body.email))
    const password = text(body.password)
    const name = text(body.name)
    const setupToken = text(body.setupToken)

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Email invalido.' }, { status: 400 })
    }

    const passwordPolicyError = getPasswordPolicyError(password, email)
    if (passwordPolicyError) {
      return NextResponse.json({ error: passwordPolicyError }, { status: 400 })
    }

    const userCount = await prisma.user.count()
    if (userCount > 0) {
      return NextResponse.json({
        error: 'O cadastro público está fechado. Peça a um administrador para criar o usuário.',
      }, { status: 403 })
    }

    const expectedSetupToken = process.env.INITIAL_ADMIN_SETUP_TOKEN
    if (!expectedSetupToken && process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        error: 'Configure INITIAL_ADMIN_SETUP_TOKEN para habilitar o cadastro inicial.',
      }, { status: 503 })
    }

    if (expectedSetupToken && (!setupToken || !tokenMatches(setupToken, expectedSetupToken))) {
      return NextResponse.json({ error: 'Token de configuracao inicial invalido.' }, { status: 403 })
    }

    const hashedPassword = await hashPassword(password)
    const user = await prisma.$transaction(async (tx) => {
      const countInsideTransaction = await tx.user.count()
      if (countInsideTransaction > 0) {
        throw new Error('INITIAL_REGISTRATION_CLOSED')
      }

      const createdUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: name || email,
          role: 'admin',
        },
      })

      await tx.landlord.create({
        data: {
          name: createdUser.name || createdUser.email,
          userId: createdUser.id,
        },
      })

      return createdUser
    })

    return NextResponse.json({ id: user.id, email: user.email })
  } catch (error: unknown) {
    if ((error as Error).message === 'INITIAL_REGISTRATION_CLOSED') {
      return NextResponse.json({
        error: 'O cadastro público está fechado. Peça a um administrador para criar o usuário.',
      }, { status: 403 })
    }
    console.error(error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
