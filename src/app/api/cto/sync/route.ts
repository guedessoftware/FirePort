import { NextResponse } from 'next/server'
import { syncCtosFromHubsoft } from '@/lib/hubsoft'
import { requireAdmin } from '@/lib/api-auth'

export async function POST() {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const result = await syncCtosFromHubsoft()
    return NextResponse.json({
      success: true,
      message: `Sincronização concluída. ${result.synced} CTOs sincronizadas, ${result.errors} erros.`,
      ...result,
    })
  } catch (error: unknown) {
    console.error(error)
    return NextResponse.json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)),
    }, { status: 500 })
  }
}
