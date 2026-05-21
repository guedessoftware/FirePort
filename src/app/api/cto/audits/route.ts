import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/api-auth'

type CtoSyncAuditRow = {
  id: string
  ctoId: string | null
  hubsoftId: string | null
  ctoName: string
  action: string
  reason: string | null
  provisioningCount: number
  portCount: number
  createdAt: Date
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const audits = await prisma.$queryRaw<CtoSyncAuditRow[]>`
      SELECT
        "id",
        "ctoId",
        "hubsoftId",
        "ctoName",
        "action",
        "reason",
        "provisioningCount",
        "portCount",
        "createdAt"
      FROM "CtoSyncAudit"
      ORDER BY "createdAt" DESC
      LIMIT 100
    `

    return NextResponse.json({ success: true, audits })
  } catch (error) {
    console.error('Error listing CTO sync audits:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
