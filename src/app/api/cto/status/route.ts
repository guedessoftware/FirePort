import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/api-auth'

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const totalCtos = await prisma.cTO.count()
    const syncedCtos = await prisma.cTO.count({
      where: { syncStatus: 'synced' }
    })
    const failedCtos = await prisma.cTO.count({
      where: { syncStatus: 'error' }
    })
    const missingInHubsoftCtos = await prisma.cTO.count({
      where: { syncStatus: 'missing_in_hubsoft' }
    })
    const auditRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM "CtoSyncAudit"
      WHERE "action" = 'missing_in_hubsoft'
    `
    const lastSync = await prisma.cTO.findFirst({
      orderBy: { lastSync: 'desc' },
      select: { lastSync: true }
    })

    return NextResponse.json({
      total: totalCtos,
      synced: syncedCtos,
      failed: failedCtos,
      missingInHubsoft: missingInHubsoftCtos,
      auditItems: Number(auditRows[0]?.count ?? 0),
      lastSync: lastSync?.lastSync,
      success: true
    })
  } catch (error) {
    console.error('Error getting sync status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
