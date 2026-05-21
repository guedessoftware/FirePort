import { NextResponse } from 'next/server'
import { listOltDrivers } from '@/lib/olt'
import { requireAuthenticated } from '@/lib/api-auth'

export async function GET() {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  return NextResponse.json({
    drivers: listOltDrivers(),
  })
}
