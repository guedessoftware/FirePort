import NextAuth, { type AuthOptions } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { Session, User } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import { ensureAuthSecuritySchema } from '@/lib/auth-schema'
import {
  clearFailedLogins,
  delayAfterFailedLogin,
  decryptAuthSecret,
  getLoginRiskInput,
  isLoginRateLimited,
  normalizeEmail,
  registerFailedLogin,
  verifyPassword,
  verifyPasswordAgainstDummyHash,
  verifyTotpCode,
} from '@/lib/auth-security'

type AppJWT = JWT & {
  role?: string
  mfaVerified?: boolean
}

type AppUser = User & {
  role?: string
  mfaVerified?: boolean
}

type AppSessionUpdate = {
  name?: string | null
  email?: string | null
}

const insecureProductionSecrets = new Set([
  'your-secret-key-here',
  'replace-with-a-secure-secret-for-dev',
])

function getAuthSecret() {
  const secret = process.env.NEXTAUTH_SECRET

  if (process.env.NODE_ENV === 'production' && (!secret || insecureProductionSecrets.has(secret))) {
    throw new Error('Configure NEXTAUTH_SECRET com um valor seguro antes de iniciar em producao.')
  }

  return secret
}

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: getAuthSecret(),
  useSecureCookies: process.env.NODE_ENV === 'production',
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    callbackUrl: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.callback-url' : 'next-auth.callback-url',
      options: {
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    csrfToken: {
      name: process.env.NODE_ENV === 'production' ? '__Host-next-auth.csrf-token' : 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        mfaCode: { label: 'Codigo MFA', type: 'text' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }
        const email = normalizeEmail(credentials.email)
        const loginRisk = getLoginRiskInput(request, email)
        if (isLoginRateLimited(loginRisk)) {
          await delayAfterFailedLogin(loginRisk)
          return null
        }
        await ensureAuthSecuritySchema()
        const rows = await prisma.$queryRaw<Array<{
          id: string
          email: string
          password: string
          name: string | null
          role: string
          mfaSecretEncrypted: string | null
          mfaEnabledAt: Date | string | null
        }>>`
          SELECT "id", "email", "password", "name", "role", "mfaSecretEncrypted", "mfaEnabledAt"
          FROM "User"
          WHERE "email" = ${email}
          LIMIT 1
        `
        const user = rows[0] ?? null
        if (!user) {
          await verifyPasswordAgainstDummyHash(credentials.password)
          registerFailedLogin(loginRisk)
          await delayAfterFailedLogin(loginRisk)
          return null
        }
        const isPasswordValid = await verifyPassword(credentials.password, user.password)
        if (!isPasswordValid) {
          registerFailedLogin(loginRisk)
          await delayAfterFailedLogin(loginRisk)
          return null
        }
        if (user.mfaSecretEncrypted && user.mfaEnabledAt) {
          const secret = decryptAuthSecret(user.mfaSecretEncrypted)
          if (!verifyTotpCode(secret, credentials.mfaCode ?? '')) {
            registerFailedLogin(loginRisk)
            await delayAfterFailedLogin(loginRisk)
            return null
          }
        }
        clearFailedLogins(loginRisk)
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mfaVerified: Boolean(user.mfaSecretEncrypted && user.mfaEnabledAt) || user.role !== 'admin',
        }
      }
    })
  ],
  session: {
    strategy: 'jwt' as const,
    maxAge: 8 * 60 * 60,
    updateAge: 15 * 60,
  },
  jwt: {
    maxAge: 8 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user, trigger, session }: { token: AppJWT; user?: AppUser | undefined; trigger?: string; session?: AppSessionUpdate }) {
      if (user) {
        token.role = user.role
        token.mfaVerified = user.mfaVerified === true
      }
      if (trigger === 'update' && session) {
        if (typeof session.name === 'string') token.name = session.name
        if (typeof session.email === 'string') token.email = session.email
      }
      return token
    },
    async session({ session, token }: { session: Session; token: AppJWT }) {
      if (token && session.user) {
        const user = session.user as Session['user'] & { id?: string; role?: string; mfaVerified?: boolean; requiresMfa?: boolean }
        const requiresMfa = token.role === 'admin' && token.mfaVerified !== true
        user.id = token.sub
        user.role = requiresMfa ? 'mfa_required' : token.role
        user.mfaVerified = token.mfaVerified === true
        user.requiresMfa = requiresMfa
        user.name = token.name
        user.email = token.email
      }
      return session
    }
  }
}

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
