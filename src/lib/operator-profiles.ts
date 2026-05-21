import { randomUUID } from 'crypto'
import { prisma } from './prisma'

export type OperatorProfileRow = {
  id: string
  userId: string
  name: string
  driver: string
  vlan: number | null
  serviceVlan: number | null
  lineProfile: string | null
  serviceProfile: string | null
  gemPort: number | null
  tcont: number | null
  serviceName: string | null
  isDefault: boolean | number
  createdAt: Date | string
  updatedAt: Date | string
  userName?: string | null
  userEmail?: string | null
}

export type OperatorProfileInput = {
  id?: string
  userId: string
  name: string
  driver: string
  vlan?: number | null
  serviceVlan?: number | null
  lineProfile?: string | null
  serviceProfile?: string | null
  gemPort?: number | null
  tcont?: number | null
  serviceName?: string | null
  isDefault?: boolean
}

function selectOperatorProfileSql() {
  return `
    SELECT
      ProvisioningProfile.id,
      ProvisioningProfile.userId,
      ProvisioningProfile.name,
      ProvisioningProfile.driver,
      ProvisioningProfile.vlan,
      ProvisioningProfile.serviceVlan,
      ProvisioningProfile.lineProfile,
      ProvisioningProfile.serviceProfile,
      ProvisioningProfile.gemPort,
      ProvisioningProfile.tcont,
      ProvisioningProfile.serviceName,
      ProvisioningProfile.isDefault,
      ProvisioningProfile.createdAt,
      ProvisioningProfile.updatedAt,
      User.name AS userName,
      User.email AS userEmail
    FROM ProvisioningProfile
    INNER JOIN User ON User.id = ProvisioningProfile.userId
  `
}

export function normalizeOperatorProfile(row: OperatorProfileRow) {
  return {
    ...row,
    isDefault: Boolean(row.isDefault),
    user: row.userName || row.userEmail
      ? {
          id: row.userId,
          name: row.userName,
          email: row.userEmail,
        }
      : undefined,
  }
}

export async function listOperatorProfiles(userId?: string) {
  const rows = userId
    ? await prisma.$queryRawUnsafe<OperatorProfileRow[]>(`
        ${selectOperatorProfileSql()}
        WHERE ProvisioningProfile.userId = ?
        ORDER BY ProvisioningProfile.isDefault DESC, ProvisioningProfile.updatedAt DESC
      `, userId)
    : await prisma.$queryRawUnsafe<OperatorProfileRow[]>(`
        ${selectOperatorProfileSql()}
        ORDER BY User.name ASC, ProvisioningProfile.isDefault DESC, ProvisioningProfile.updatedAt DESC
      `)

  return rows.map(normalizeOperatorProfile)
}

export async function getDefaultOperatorProfile(userId: string, driver?: string) {
  const rows = driver
    ? await prisma.$queryRawUnsafe<OperatorProfileRow[]>(`
        ${selectOperatorProfileSql()}
        WHERE ProvisioningProfile.userId = ?
          AND ProvisioningProfile.driver = ?
        ORDER BY ProvisioningProfile.isDefault DESC, ProvisioningProfile.updatedAt DESC
        LIMIT 1
      `, userId, driver)
    : await prisma.$queryRawUnsafe<OperatorProfileRow[]>(`
        ${selectOperatorProfileSql()}
        WHERE ProvisioningProfile.userId = ?
        ORDER BY ProvisioningProfile.isDefault DESC, ProvisioningProfile.updatedAt DESC
        LIMIT 1
      `, userId)

  return rows[0] ? normalizeOperatorProfile(rows[0]) : null
}

export async function upsertOperatorProfile(input: OperatorProfileInput) {
  const id = input.id || randomUUID()
  const isDefault = input.isDefault ?? false

  if (isDefault) {
    await prisma.$executeRaw`
      UPDATE ProvisioningProfile
      SET isDefault = false, updatedAt = CURRENT_TIMESTAMP
      WHERE userId = ${input.userId}
        AND driver = ${input.driver}
    `
  }

  if (input.id) {
    await prisma.$executeRaw`
      UPDATE ProvisioningProfile
      SET
        userId = ${input.userId},
        name = ${input.name},
        driver = ${input.driver},
        vlan = ${input.vlan ?? null},
        serviceVlan = ${input.serviceVlan ?? null},
        lineProfile = ${input.lineProfile ?? null},
        serviceProfile = ${input.serviceProfile ?? null},
        gemPort = ${input.gemPort ?? null},
        tcont = ${input.tcont ?? null},
        serviceName = ${input.serviceName ?? null},
        isDefault = ${isDefault},
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${input.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO ProvisioningProfile (
        id,
        userId,
        name,
        driver,
        vlan,
        serviceVlan,
        lineProfile,
        serviceProfile,
        gemPort,
        tcont,
        serviceName,
        isDefault,
        updatedAt
      ) VALUES (
        ${id},
        ${input.userId},
        ${input.name},
        ${input.driver},
        ${input.vlan ?? null},
        ${input.serviceVlan ?? null},
        ${input.lineProfile ?? null},
        ${input.serviceProfile ?? null},
        ${input.gemPort ?? null},
        ${input.tcont ?? null},
        ${input.serviceName ?? null},
        ${isDefault},
        CURRENT_TIMESTAMP
      )
    `
  }

  const rows = await prisma.$queryRawUnsafe<OperatorProfileRow[]>(`
    ${selectOperatorProfileSql()}
    WHERE ProvisioningProfile.id = ?
    LIMIT 1
  `, id)

  return rows[0] ? normalizeOperatorProfile(rows[0]) : null
}
