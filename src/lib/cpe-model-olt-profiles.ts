import { randomUUID } from 'crypto'
import { prisma } from './prisma'

export type CpeModelOltProfileRow = {
  id: string
  cpeModelId: string
  oltManufacturer: string
  oltModel: string
  oltDriver: string
  onuType: string | null
  authorizationCommands: string | null
  provisioningCommands: string | null
  deprovisioningCommands: string | null
  deauthorizationCommands: string | null
  tr069Commands: string | null
  genieAcsParameterMapJson: string | null
  requiredVariablesJson: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export type CpeModelOltProfileInput = {
  id?: string
  cpeModelId: string
  oltManufacturer: string
  oltModel: string
  oltDriver: string
  onuType?: string | null
  authorizationCommands?: string | null
  provisioningCommands?: string | null
  deprovisioningCommands?: string | null
  deauthorizationCommands?: string | null
  tr069Commands?: string | null
  genieAcsParameterMapJson?: string | null
  requiredVariablesJson?: string | null
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeOltIdentity(input: { manufacturer?: string | null; model?: string | null; driver?: string | null }) {
  return {
    manufacturer: cleanText(input.manufacturer),
    model: cleanText(input.model),
    driver: cleanText(input.driver),
  }
}

export function oltModelCompatibilityKey(model?: string | null) {
  const normalized = cleanText(model).toUpperCase()
  const cSeries = normalized.match(/\bC\d{3,4}\b/)
  if (cSeries) return cSeries[0]
  return normalized.replace(/[^A-Z0-9]/g, '')
}

export function normalizeCpeModelOltProfile(row: CpeModelOltProfileRow) {
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
}

export async function listCpeModelOltProfiles(cpeModelId?: string) {
  const rows = cpeModelId
    ? await prisma.$queryRaw<CpeModelOltProfileRow[]>`
        SELECT *
        FROM "CpeModelOltProfile"
        WHERE "cpeModelId" = ${cpeModelId}
        ORDER BY lower("oltManufacturer") ASC, lower("oltModel") ASC, lower("oltDriver") ASC
      `
    : await prisma.$queryRaw<CpeModelOltProfileRow[]>`
        SELECT *
        FROM "CpeModelOltProfile"
        ORDER BY lower("oltManufacturer") ASC, lower("oltModel") ASC, lower("oltDriver") ASC
      `

  return rows.map(normalizeCpeModelOltProfile)
}

export async function getCompatibleCpeModelOltProfile(
  cpeModelId: string,
  oltIdentity: { manufacturer?: string | null; model?: string | null; driver?: string | null },
) {
  const identity = normalizeOltIdentity(oltIdentity)
  if (!identity.manufacturer || !identity.model || !identity.driver) {
    return null
  }

  const rows = await prisma.$queryRaw<CpeModelOltProfileRow[]>`
    SELECT *
    FROM "CpeModelOltProfile"
    WHERE "cpeModelId" = ${cpeModelId}
      AND lower("oltManufacturer") = lower(${identity.manufacturer})
      AND lower("oltModel") = lower(${identity.model})
      AND lower("oltDriver") = lower(${identity.driver})
    LIMIT 1
  `
  if (rows[0]) return normalizeCpeModelOltProfile(rows[0])

  const compatibleRows = await prisma.$queryRaw<CpeModelOltProfileRow[]>`
    SELECT *
    FROM "CpeModelOltProfile"
    WHERE "cpeModelId" = ${cpeModelId}
      AND lower("oltManufacturer") = lower(${identity.manufacturer})
      AND lower("oltDriver") = lower(${identity.driver})
  `
  const identityModelKey = oltModelCompatibilityKey(identity.model)
  const compatibleRow = compatibleRows.find((row) => oltModelCompatibilityKey(row.oltModel) === identityModelKey)

  return compatibleRow ? normalizeCpeModelOltProfile(compatibleRow) : null
}

export async function upsertCpeModelOltProfile(input: CpeModelOltProfileInput) {
  const id = input.id || randomUUID()
  const identity = normalizeOltIdentity({
    manufacturer: input.oltManufacturer,
    model: input.oltModel,
    driver: input.oltDriver,
  })

  if (!input.cpeModelId || !identity.manufacturer || !identity.model || !identity.driver) {
    throw new Error('Modelo de ONU, fabricante/modelo da OLT e driver sao obrigatorios.')
  }

  if (input.id) {
    await prisma.$executeRaw`
      UPDATE "CpeModelOltProfile"
      SET
        "oltManufacturer" = ${identity.manufacturer},
        "oltModel" = ${identity.model},
        "oltDriver" = ${identity.driver},
        "onuType" = ${input.onuType ?? null},
        "authorizationCommands" = ${input.authorizationCommands ?? null},
        "provisioningCommands" = ${input.provisioningCommands ?? null},
        "deprovisioningCommands" = ${input.deprovisioningCommands ?? null},
        "deauthorizationCommands" = ${input.deauthorizationCommands ?? null},
        "tr069Commands" = ${input.tr069Commands ?? null},
        "genieAcsParameterMapJson" = ${input.genieAcsParameterMapJson ?? null},
        "requiredVariablesJson" = ${input.requiredVariablesJson ?? null},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}
        AND "cpeModelId" = ${input.cpeModelId}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO "CpeModelOltProfile" (
        "id",
        "cpeModelId",
        "oltManufacturer",
        "oltModel",
        "oltDriver",
        "onuType",
        "authorizationCommands",
        "provisioningCommands",
        "deprovisioningCommands",
        "deauthorizationCommands",
        "tr069Commands",
        "genieAcsParameterMapJson",
        "requiredVariablesJson",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${input.cpeModelId},
        ${identity.manufacturer},
        ${identity.model},
        ${identity.driver},
        ${input.onuType ?? null},
        ${input.authorizationCommands ?? null},
        ${input.provisioningCommands ?? null},
        ${input.deprovisioningCommands ?? null},
        ${input.deauthorizationCommands ?? null},
        ${input.tr069Commands ?? null},
        ${input.genieAcsParameterMapJson ?? null},
        ${input.requiredVariablesJson ?? null},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT("cpeModelId", "oltManufacturer", "oltModel", "oltDriver") DO UPDATE SET
        "onuType" = excluded."onuType",
        "authorizationCommands" = excluded."authorizationCommands",
        "provisioningCommands" = excluded."provisioningCommands",
        "deprovisioningCommands" = excluded."deprovisioningCommands",
        "deauthorizationCommands" = excluded."deauthorizationCommands",
        "tr069Commands" = excluded."tr069Commands",
        "genieAcsParameterMapJson" = excluded."genieAcsParameterMapJson",
        "requiredVariablesJson" = excluded."requiredVariablesJson",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  }

  const rows = await prisma.$queryRaw<CpeModelOltProfileRow[]>`
    SELECT *
    FROM "CpeModelOltProfile"
    WHERE "cpeModelId" = ${input.cpeModelId}
      AND lower("oltManufacturer") = lower(${identity.manufacturer})
      AND lower("oltModel") = lower(${identity.model})
      AND lower("oltDriver") = lower(${identity.driver})
    LIMIT 1
  `

  return rows[0] ? normalizeCpeModelOltProfile(rows[0]) : null
}

export async function deleteCpeModelOltProfile(id: string, cpeModelId: string) {
  await prisma.$executeRaw`
    DELETE FROM "CpeModelOltProfile"
    WHERE "id" = ${id}
      AND "cpeModelId" = ${cpeModelId}
  `
}
