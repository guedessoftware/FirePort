import { NextResponse } from 'next/server'
import { fetchHubsoftCTOs } from '@/lib/hubsoft'
import { requireAdmin } from '@/lib/api-auth'

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const ctos = await fetchHubsoftCTOs()
    return NextResponse.json(ctos)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Failed to fetch Hubsoft CTOs' }, { status: 500 })
  }
}
