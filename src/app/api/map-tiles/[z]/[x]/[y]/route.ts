import { NextRequest, NextResponse } from 'next/server'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

const TILE_CACHE_DIR = path.join(process.cwd(), '.tile-cache', 'osm')
const TILE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function parseTilePart(value: string, max: number) {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

function placeholderTile(message = 'Mapa offline') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#eef2f7"/>
  <path d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="#d8e0ea" stroke-width="1"/>
  <text x="128" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#64748b">${message}</text>
  <text x="128" y="144" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#94a3b8">tile nao armazenado</text>
</svg>`
}

async function readCachedTile(filePath: string) {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

export async function GET(_request: NextRequest, context: RouteContext<'/api/map-tiles/[z]/[x]/[y]'>) {
  const params = await context.params
  const yPart = params.y.replace(/\.png$/i, '')
  const z = parseTilePart(params.z, 19)
  const maxTileIndex = z === null ? Number.MAX_SAFE_INTEGER : (2 ** z) - 1
  const x = parseTilePart(params.x, maxTileIndex)
  const y = parseTilePart(yPart, maxTileIndex)

  if (z === null || x === null || y === null) {
    return new NextResponse(placeholderTile('Tile invalido'), {
      status: 400,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
    })
  }

  const filePath = path.join(TILE_CACHE_DIR, String(z), String(x), `${y}.png`)
  const cachedTile = await readCachedTile(filePath)

  if (cachedTile) {
    return new NextResponse(new Uint8Array(cachedTile), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': `public, max-age=${TILE_MAX_AGE_SECONDS}, immutable`,
      },
    })
  }

  const subdomains = ['a', 'b', 'c']
  const subdomain = subdomains[(x + y) % subdomains.length]
  const upstreamUrl = `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'FirePort local tile cache',
        Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
      },
      next: { revalidate: TILE_MAX_AGE_SECONDS },
    })

    if (!response.ok) {
      throw new Error(`tile upstream ${response.status}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, bytes)

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': `public, max-age=${TILE_MAX_AGE_SECONDS}, immutable`,
      },
    })
  } catch (error) {
    console.warn('[MAP TILES] falha ao baixar tile; usando placeholder local', { z, x, y, error })
    return new NextResponse(placeholderTile(), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }
}
