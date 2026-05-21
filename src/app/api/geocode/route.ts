import { NextRequest, NextResponse } from 'next/server'
import { requireAuthenticated } from '@/lib/api-auth'

async function searchGoogleGeocoding(address: string) {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY
  if (!apiKey) return null

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&region=br`
  const response = await fetch(url)
  if (!response.ok) return null

  const data = await response.json()
  if (data.status !== 'OK' || !data.results.length) return null

  const result = data.results[0]
  return {
    lat: result.geometry.location.lat,
    lon: result.geometry.location.lng,
    display_name: result.formatted_address,
  }
}

type ViaCepAddress = {
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean
}

type GeocodeAddressContext = Omit<ViaCepAddress, 'erro'>

async function fetchPostalCodeAddress(postalCode: string) {
  const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`)
  if (!response.ok) return null

  const data = await response.json() as ViaCepAddress
  if (data.erro) return null
  return data
}

function buildNominatimUrl(params: Record<string, string>) {
  const searchParams = new URLSearchParams({
    format: 'json',
    limit: '5',
    addressdetails: '1',
    countrycodes: 'br',
    ...params,
  })
  return `https://nominatim.openstreetmap.org/search?${searchParams.toString()}`
}

function composeAddressWithNumber(address: string, number: string) {
  const cleanNumber = number.trim()
  if (!cleanNumber) return address

  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return address

  const secondPartIsNumber = parts[1] && /^\d+[a-zA-Z-]*$/.test(parts[1].replace(/\s/g, ''))
  if (secondPartIsNumber) {
    parts[1] = cleanNumber
    return parts.join(', ')
  }

  const streetAlreadyHasNumber = /\b\d+[a-zA-Z-]*\b/.test(parts[0])
  if (streetAlreadyHasNumber) return address

  return [parts[0], cleanNumber, ...parts.slice(1)].join(', ')
}

function sanitizeAddressInput(value: string) {
  return value.replace(/['"]/g, '').trim()
}

function isPostalCode(address: string) {
  return /^\d{8}$/.test(address.replace(/\D/g, ''))
}

function composePostalCodeQuery(postalCode: string, number: string) {
  return [number.trim(), postalCode.replace(/\D/g, ''), 'Brasil'].filter(Boolean).join(', ')
}

function composeCanonicalAddress(street: string, number: string, neighborhood: string, city: string, state: string) {
  const streetAndNumber = [street, number].filter(Boolean).join(', ')
  const neighborhoodPart = neighborhood ? ` - ${neighborhood}` : ''
  const cityState = [city, state].filter(Boolean).join(' - ')
  return [streetAndNumber ? `${streetAndNumber}${neighborhoodPart}` : '', cityState].filter(Boolean).join(', ')
}

function contextToPostalAddress(context: string): GeocodeAddressContext | null {
  const normalized = context.trim()
  if (!normalized) return null

  const parsed = parseAddress(normalized)
  if (!parsed.street && !parsed.neighborhood && !parsed.city && !parsed.state) return null
  return {
    logradouro: parsed.street,
    bairro: parsed.neighborhood,
    localidade: parsed.city,
    uf: parsed.state,
  }
}

function composePostalAddressQueries(postalCode: string, number: string, postalAddress: GeocodeAddressContext | null) {
  const cleanPostalCode = postalCode.replace(/\D/g, '')
  const cleanNumber = number.trim()
  const street = postalAddress?.logradouro?.trim() || ''
  const neighborhood = postalAddress?.bairro?.trim() || ''
  const city = postalAddress?.localidade?.trim() || ''
  const state = postalAddress?.uf?.trim() || ''
  const queries = [
    composeCanonicalAddress(street, cleanNumber, neighborhood, city, state),
    composeCanonicalAddress(street, cleanNumber, '', city, state),
    composePostalCodeQuery(cleanPostalCode, cleanNumber),
  ]

  return Array.from(new Set(queries.filter(Boolean)))
}

function parseAddress(address: string, explicitNumber = '') {
  const canonicalMatch = address.trim().match(/^(.+?),\s*(?:(\d+[a-zA-Z-]*)\s*-\s*)?(.+?),\s*([^,/]+?)\s*[-/]\s*([A-Z]{2})$/i)
  if (canonicalMatch) {
    return {
      street: canonicalMatch[1]?.trim() || '',
      number: explicitNumber || canonicalMatch[2]?.trim() || '',
      neighborhood: canonicalMatch[3]?.trim() || '',
      city: canonicalMatch[4]?.trim() || '',
      state: canonicalMatch[5]?.trim().toUpperCase() || '',
    }
  }

  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  const hasNumberInStreet = parts[1] && /^\d+$/.test(parts[1].replace(/\D/g, ''))
  const street = hasNumberInStreet ? parts[0] : parts[0]
  const number = explicitNumber || (hasNumberInStreet ? parts[1] : '')

  const parsed = {
    street,
    number,
    neighborhood: '',
    city: '',
    state: '',
  }

  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart.includes('/')) {
    const [cityPart, statePart] = lastPart.split('/').map((part) => part.trim())
    parsed.city = cityPart
    parsed.state = statePart
  } else if (parts.length > 2) {
    if (!hasNumberInStreet && !explicitNumber && parsed.number) {
      parsed.neighborhood = parts[1] || ''
      if (parts.length > 2) {
        parsed.city = parts[2] || ''
        if (parts.length > 3) {
          parsed.state = parts[3] || ''
        }
      }
    } else {
      parsed.neighborhood = parts[1] || ''
      parsed.city = parts[2] || ''
      parsed.state = parts[3] || ''
    }
  }

  return parsed
}

async function searchNominatim(params: Record<string, string>) {
  const url = buildNominatimUrl(params)
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'fireport-app/1.0',
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Geocoding failed: ${response.status} ${body}`)
  }

  const results = await response.json()
  if (!Array.isArray(results) || results.length === 0) {
    return null
  }

  const typePriority: Record<string, number> = {
    house: 1,
    building: 2,
    place: 3,
    road: 4,
    highway: 5,
  }

  results.sort((a, b) => {
    const aType = typePriority[a.addresstype] ?? 99
    const bType = typePriority[b.addresstype] ?? 99
    if (aType !== bType) return aType - bType
    return (a.place_rank || 99) - (b.place_rank || 99)
  })

  return results[0]
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticated()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')
  const number = searchParams.get('number')
  const context = searchParams.get('context') || ''

  if (!address) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 })
  }

  try {
    const cleanAddress = sanitizeAddressInput(address)
    const cleanNumber = sanitizeAddressInput(number || '')
    const cleanContext = sanitizeAddressInput(context)
    const postalCode = isPostalCode(cleanAddress) ? cleanAddress.replace(/\D/g, '') : ''
    const addressWithNumber = composeAddressWithNumber(cleanAddress, cleanNumber)

    if (postalCode) {
      const postalAddress = contextToPostalAddress(cleanContext) ?? await fetchPostalCodeAddress(postalCode)
      const postalQueries = composePostalAddressQueries(postalCode, cleanNumber, postalAddress)

      for (const query of postalQueries) {
        const googleLocation = await searchGoogleGeocoding(query)
        if (googleLocation) {
          return NextResponse.json({
            lat: Number(googleLocation.lat),
            lng: Number(googleLocation.lon),
            displayName: googleLocation.display_name,
          })
        }
      }

      for (const query of postalQueries) {
        const nominatimLocation = await searchNominatim({ q: query })
        if (nominatimLocation) {
          return NextResponse.json({
            lat: Number(nominatimLocation.lat),
            lng: Number(nominatimLocation.lon),
            displayName: nominatimLocation.display_name,
          })
        }
      }

      return NextResponse.json({ error: 'Endereço não encontrado' }, { status: 404 })
    }

    if (cleanNumber && process.env.GOOGLE_GEOCODING_API_KEY) {
      const location = await searchGoogleGeocoding(addressWithNumber)
      if (location) {
        return NextResponse.json({
          lat: Number(location.lat),
          lng: Number(location.lon),
          displayName: location.display_name,
        })
      }
    }

    let location = await searchGoogleGeocoding(cleanNumber ? addressWithNumber : cleanAddress)

    if (!location) {
      location = await searchNominatim({ q: cleanNumber ? addressWithNumber : cleanAddress })
    }

    if (!location) {
      const parsed = parseAddress(cleanAddress, cleanNumber)
      if (parsed.number) {
        location = await searchNominatim({
          street: `${parsed.number} ${parsed.street}`,
          city: parsed.city,
          state: parsed.state,
        })
      }
    }

    if (!location) {
      const parsed = parseAddress(cleanAddress, cleanNumber)
      const queryWithParts = `${parsed.street}${parsed.number ? `, ${parsed.number}` : ''}, ${parsed.neighborhood}, ${parsed.city}, ${parsed.state}`.replace(/, ,/g, ',').replace(/, $/, '').trim()
      location = await searchNominatim({ q: queryWithParts })
    }

    if (!location) {
      const parsed = parseAddress(cleanAddress, cleanNumber)
      const queryStreetCity = `${parsed.street}${parsed.number ? `, ${parsed.number}` : ''}, ${parsed.city}, ${parsed.state}`.replace(/, ,/g, ',').replace(/, $/, '').trim()
      location = await searchNominatim({ q: queryStreetCity })
    }

    if (!location) {
      return NextResponse.json({ error: 'Endereço não encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      lat: Number(location.lat),
      lng: Number(location.lon),
      displayName: location.display_name,
    })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Geocoding error' }, { status: 500 })
  }
}
