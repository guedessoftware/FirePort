import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthenticated } from '@/lib/api-auth'
import { haversineDistance } from '@/lib/utils'
import { getApplicationSettings } from '@/lib/app-settings'

function isValidCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    lat !== 0 &&
    lng !== 0
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))

  if (!isValidCoordinate(lat, lng)) {
    return NextResponse.json({ error: 'Latitude e longitude validas sao obrigatorias.' }, { status: 400 })
  }

  try {
    const settings = await getApplicationSettings()
    const radiusMeters = settings.viabilityRadiusMeters
    const radiusKm = radiusMeters / 1000
    const latDelta = radiusKm / 111.32
    const lngDelta = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180))

    const ctos = await prisma.cTO.findMany({
      where: {
        lat: { gte: lat - latDelta, lte: lat + latDelta },
        lng: { gte: lng - lngDelta, lte: lng + lngDelta },
        OR: [
          { syncStatus: null },
          { syncStatus: { not: 'missing_in_hubsoft' } },
        ],
        ports: {
          some: { status: 'available' },
        },
      },
      include: {
        ports: {
          where: { status: 'available' },
          orderBy: { number: 'asc' },
        },
      },
    })

    const viableCtos = ctos
      .filter((cto) => isValidCoordinate(cto.lat, cto.lng))
      .map((cto) => {
        const distance = haversineDistance(lat, lng, cto.lat, cto.lng)
        return {
          id: cto.id,
          name: cto.name,
          address: cto.address,
          lat: cto.lat,
          lng: cto.lng,
          ports: cto.ports.map((port) => ({
            id: port.id,
            number: port.number,
            status: port.status,
            ctoId: port.ctoId,
          })),
          distance,
          distanceMeters: distance * 1000,
        }
      })
      .filter((cto) => cto.distanceMeters <= radiusMeters && cto.ports.length > 0)
      .sort((left, right) => left.distanceMeters - right.distanceMeters)
      .slice(0, 10)

    return NextResponse.json({
      radiusMeters,
      ctos: viableCtos,
    })
  } catch (error) {
    console.error('Error checking local CTO viability:', error)
    return NextResponse.json({ error: 'Erro ao consultar viabilidade local.' }, { status: 500 })
  }
}
