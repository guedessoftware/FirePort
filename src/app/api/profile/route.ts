import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]/route'
import { normalizeColorTheme } from '@/lib/color-themes'
import { getPasswordPolicyError, hashPassword, isValidEmail, normalizeEmail, verifyPassword } from '@/lib/auth-security'

async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) return null

  return prisma.user.findUnique({ where: { id: userId } })
}

function normalizeProfileImage(value: unknown) {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  if (value.length > 1_000_000) return undefined
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return undefined
  return value
}

async function getProfilePreferences(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ image: string | null; colorTheme: string | null }>>`
    SELECT image, colorTheme FROM User WHERE id = ${userId} LIMIT 1
  `

  return {
    image: rows[0]?.image ?? null,
    colorTheme: normalizeColorTheme(rows[0]?.colorTheme) ?? 'orange',
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    const preferences = await getProfilePreferences(user.id)

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: preferences.image,
      colorTheme: preferences.colorTheme,
      role: user.role,
    })
  } catch (error) {
    console.error('Profile read error:', error)
    return NextResponse.json({ error: 'Erro ao carregar perfil.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    }

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    const existingPreferences = await getProfilePreferences(user.id)
    const hasImageInput = Object.prototype.hasOwnProperty.call(body, 'image')
    const image = hasImageInput ? normalizeProfileImage(body.image) : existingPreferences.image
    const colorTheme = normalizeColorTheme(body.colorTheme) ?? existingPreferences.colorTheme

    if (!name || !email) {
      return NextResponse.json({ error: 'Informe nome e email.' }, { status: 400 })
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Informe um email valido.' }, { status: 400 })
    }
    if (image === undefined) {
      return NextResponse.json({ error: 'Imagem invalida. Envie PNG, JPG ou WebP com ate 1 MB.' }, { status: 400 })
    }

    const data: { name: string; email: string; password?: string } = { name, email }

    if (email !== user.email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id: user.id },
        },
      })
      if (existingUser) {
        return NextResponse.json({ error: 'Ja existe um usuario com este email.' }, { status: 400 })
      }
    }

    if (newPassword) {
      const passwordPolicyError = getPasswordPolicyError(newPassword, email)
      if (passwordPolicyError) {
        return NextResponse.json({ error: passwordPolicyError }, { status: 400 })
      }
      const isPasswordValid = await verifyPassword(currentPassword, user.password)
      if (!isPasswordValid) {
        return NextResponse.json({ error: 'Senha atual invalida.' }, { status: 400 })
      }
      data.password = await hashPassword(newPassword)
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    })

    if (image !== existingPreferences.image || colorTheme !== existingPreferences.colorTheme) {
      await prisma.$executeRaw`
        UPDATE User SET image = ${image}, colorTheme = ${colorTheme}, updatedAt = CURRENT_TIMESTAMP WHERE id = ${user.id}
      `
    }

    if (name !== user.name) {
      await prisma.landlord.updateMany({
        where: { userId: user.id },
        data: { name },
      })
    }

    return NextResponse.json({ ...updatedUser, image, colorTheme })
  } catch (error) {
    console.error('Profile update error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar perfil.' }, { status: 500 })
  }
}
