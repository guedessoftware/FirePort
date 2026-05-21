import { NextResponse } from 'next/server'

const cookieNames = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.callback-url',
  '__Secure-next-auth.callback-url',
  'authjs.callback-url',
  '__Secure-authjs.callback-url',
  'next-auth.csrf-token',
  '__Host-next-auth.csrf-token',
  'authjs.csrf-token',
  '__Host-authjs.csrf-token',
  'next-auth.pkce.code_verifier',
  '__Secure-next-auth.pkce.code_verifier',
  'authjs.pkce.code_verifier',
  '__Secure-authjs.pkce.code_verifier',
  'next-auth.state',
  '__Secure-next-auth.state',
  'authjs.state',
  '__Secure-authjs.state',
  'next-auth.nonce',
  '__Secure-next-auth.nonce',
  'authjs.nonce',
  '__Secure-authjs.nonce',
]

function expireCookie(response: NextResponse, name: string) {
  response.cookies.set(name, '', {
    httpOnly: !name.includes('callback-url'),
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(0),
    maxAge: 0,
    path: '/',
  })
}

export async function GET() {
  return POST()
}

export async function POST() {
  const response = NextResponse.json({ ok: true })

  for (const cookieName of cookieNames) {
    expireCookie(response, cookieName)
    for (let index = 0; index < 8; index += 1) {
      expireCookie(response, `${cookieName}.${index}`)
    }
  }

  return response
}
