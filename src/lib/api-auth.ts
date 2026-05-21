import { getServerSession } from 'next-auth'
import { prisma } from './prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

export async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id

  if (!userId) {
    return null
  }

  return prisma.user.findUnique({
    where: { id: userId },
  })
}

export async function requireAuthenticated() {
  const user = await getCurrentUser()

  if (!user) {
    return { user: null, error: 'Sessao invalida ou expirada.', status: 401 }
  }

  return { user, error: null, status: 200 }
}

export async function requireAdmin() {
  const auth = await requireAuthenticated()

  if (!auth.user) {
    return auth
  }

  if (auth.user.role !== 'admin') {
    return { user: null, error: 'Apenas administradores podem acessar este recurso.', status: 403 }
  }

  const session = await getServerSession(authOptions)
  const mfaVerified = (session?.user as { mfaVerified?: boolean } | undefined)?.mfaVerified === true
  if (!mfaVerified) {
    return { user: null, error: 'Configure e confirme o MFA para acessar recursos administrativos.', status: 403 }
  }

  return { user: auth.user, error: null, status: 200 }
}
