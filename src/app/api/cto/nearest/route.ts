import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { haversineDistance } from '@/lib/utils'
import { fetchHubsoftCTOs } from '@/lib/hubsoft'
import { requireAuthenticated } from '@/lib/api-auth'
import { getApplicationSettings } from '@/lib/app-settings'

type NearbyCtoSource = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  ports: { id: string; number: number; status: string; ctoId: string }[]
}

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

function filterCtosInsideRadius(ctos: NearbyCtoSource[], lat: number, lng: number, radiusMeters: number) {
  return ctos
    .filter((cto) => isValidCoordinate(cto.lat, cto.lng))
    .map((cto) => {
      const distance = haversineDistance(lat, lng, cto.lat, cto.lng)

      return {
        ...cto,
        distance,
        distanceMeters: distance * 1000,
      }
    })
    .filter((cto) => cto.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const lat = latParam !== null ? parseFloat(latParam) : NaN
  const lng = lngParam !== null ? parseFloat(lngParam) : NaN

  if (!isValidCoordinate(lat, lng)) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
  }

  try {
    const settings = await getApplicationSettings()
    const radiusMeters = settings.viabilityRadiusMeters
    const radiusKm = radiusMeters / 1000
    
    // Expand the bounding box search to 5km radius to catch CTOs in range
    const searchRadiusKm = Math.max(radiusKm * 5, 1) // At least 1km, or 5x the configured radius
    const latDelta = searchRadiusKm / 111.32
    const lngDelta = searchRadiusKm / (111.32 * Math.cos(lat * Math.PI / 180))

    const localCtos = await prisma.cTO.findMany({
      where: {
        lat: { gte: lat - latDelta, lte: lat + latDelta },
        lng: { gte: lng - lngDelta, lte: lng + lngDelta },
        OR: [
          { syncStatus: null },
          { syncStatus: { not: 'missing_in_hubsoft' } },
        ],
      },
      include: { ports: true },
    })

    let ctosWithDistance = filterCtosInsideRadius(localCtos, lat, lng, radiusMeters)

    // Fallback to Hubsoft if local cache has no CTO inside the configured radius.
    if (ctosWithDistance.length === 0 && process.env.HUBSOFT_API_URL) {
      try {
        const hubsoftCtos = await fetchHubsoftCTOs()
        const fallbackCtos = hubsoftCtos.map((cto) => ({
          id: cto.id,
          name: cto.name,
          address: cto.address,
          lat: cto.lat,
          lng: cto.lng,
          ports: cto.ports?.map((port) => ({
            id: port.id,
            number: port.number,
            status: port.status,
            ctoId: cto.id,
          })) || [],
        }))

        ctosWithDistance = filterCtosInsideRadius(fallbackCtos, lat, lng, radiusMeters)
      } catch (error) {
        console.error('Failed to fetch from Hubsoft:', error)
      }
    }

    return NextResponse.json(ctosWithDistance.slice(0, 10))
  } catch (error) {
    console.error('Error finding nearest CTOs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
