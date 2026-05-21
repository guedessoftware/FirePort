import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto'
import { prisma } from './prisma'

export type OltDeviceRow = {
  id: string
  hubsoftId: string | null
  name: string
  manufacturer: string
  model: string
  pop: string | null
  managementServer: string | null
  host: string
  ipv4: string | null
  ipv6: string | null
  username: string
  port: number
  passwordEncrypted: string
  enablePasswordEncrypted: string | null
  useEnableMode: boolean | number
  driver: string
  profileId: string | null
  terminalLengthCommand: string | null
  enterConfigCommand: string | null
  showOnuStateCommand: string | null
  serialLookupCommand: string | null
  rebootOnuCommand: string | null
  saveConfigCommand: string | null
  exitCommands: string | null
  snmpEnabled: boolean | number
  snmpVersion: string
  snmpCommunityEncrypted: string | null
  snmpPort: number
  snmpVendor: string
  isDefault: boolean | number
  isActive: boolean | number
  createdAt: Date | string
  updatedAt: Date | string
}

export type OltDeviceInput = {
  id?: string
  hubsoftId?: string | null
  name: string
  manufacturer: string
  model: string
  pop?: string | null
  managementServer?: string | null
  host: string
  ipv4?: string | null
  ipv6?: string | null
  username: string
  port: number
  password?: string | null
  enablePassword?: string | null
  useEnableMode?: boolean
  driver: string
  profileId?: string | null
  terminalLengthCommand?: string | null
  enterConfigCommand?: string | null
  showOnuStateCommand?: string | null
  serialLookupCommand?: string | null
  rebootOnuCommand?: string | null
  saveConfigCommand?: string | null
  exitCommands?: string | null
  snmpEnabled?: boolean
  snmpVersion?: string
  snmpCommunity?: string | null
  snmpPort?: number
  snmpVendor?: string
  isDefault?: boolean
  isActive?: boolean
}

export type OltDeviceConnection = Omit<ReturnType<typeof normalizeOltDevice>, 'hasPassword' | 'hasEnablePassword'> & {
  password: string
  enablePassword: string | null
  snmpCommunity: string | null
}

export type OltSnmpDeviceConnection = Pick<
  ReturnType<typeof normalizeOltDevice>,
  'id' | 'name' | 'host' | 'ipv4' | 'snmpEnabled' | 'snmpVersion' | 'snmpPort' | 'snmpVendor' | 'isActive'
> & {
  snmpCommunity: string | null
}

export class OltSecretDecryptionError extends Error {
  oltId: string
  oltName: string
  field: string

  constructor(input: { oltId: string; oltName: string; field: string; cause?: unknown }) {
    super(`Nao foi possivel ler ${input.field} da OLT ${input.oltName}. Recadastre a senha/community desta OLT nas configuracoes.`)
    this.name = 'OltSecretDecryptionError'
    this.oltId = input.oltId
    this.oltName = input.oltName
    this.field = input.field
    this.cause = input.cause
  }
}

export function isOltSecretDecryptionError(error: unknown): error is OltSecretDecryptionError {
  return error instanceof OltSecretDecryptionError
}

function getEncryptionKey() {
  const secret = process.env.OLT_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('Configure OLT_SECRET ou NEXTAUTH_SECRET para criptografar senhas de OLT.')
  }

  return createHash('sha256').update(secret).digest()
}

function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

function decryptSecret(value: string) {
  if (!value.startsWith('v1:')) {
    return value
  }

  const [, iv, tag, encrypted] = value.split(':')
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function decryptDeviceSecret(row: Pick<OltDeviceRow, 'id' | 'name'>, value: string, field: string) {
  try {
    return decryptSecret(value)
  } catch (error) {
    throw new OltSecretDecryptionError({
      oltId: row.id,
      oltName: row.name,
      field,
      cause: error,
    })
  }
}

function decryptDeviceSecretsForConnection(row: OltDeviceRow) {
  const password = decryptDeviceSecret(row, row.passwordEncrypted, 'senha SSH')
  let enablePassword: string | null = null

  if (Boolean(row.useEnableMode) && row.enablePasswordEncrypted) {
    try {
      enablePassword = decryptDeviceSecret(row, row.enablePasswordEncrypted, 'senha enable')
    } catch (error) {
      console.warn(`Nao foi possivel ler senha enable da OLT ${row.name}. Usando senha SSH como fallback para enable.`, error)
      enablePassword = password
    }
  }

  return {
    password,
    enablePassword,
    snmpCommunity: row.snmpCommunityEncrypted ? decryptDeviceSecret(row, row.snmpCommunityEncrypted, 'community SNMP') : null,
  }
}

export function normalizeOltDevice(row: OltDeviceRow) {
  return {
    id: row.id,
    hubsoftId: row.hubsoftId,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    pop: row.pop,
    managementServer: row.managementServer,
    host: row.host,
    ipv4: row.ipv4,
    ipv6: row.ipv6,
    username: row.username,
    port: row.port,
    useEnableMode: Boolean(row.useEnableMode),
    driver: row.driver,
    profileId: row.profileId,
    terminalLengthCommand: row.terminalLengthCommand,
    enterConfigCommand: row.enterConfigCommand,
    showOnuStateCommand: row.showOnuStateCommand,
    serialLookupCommand: row.serialLookupCommand,
    rebootOnuCommand: row.rebootOnuCommand,
    saveConfigCommand: row.saveConfigCommand,
    exitCommands: row.exitCommands,
    snmpEnabled: Boolean(row.snmpEnabled),
    snmpVersion: row.snmpVersion || '2c',
    snmpPort: row.snmpPort || 161,
    snmpVendor: row.snmpVendor || 'zte_titan',
    isDefault: Boolean(row.isDefault),
    isActive: Boolean(row.isActive),
    hasPassword: Boolean(row.passwordEncrypted),
    hasEnablePassword: Boolean(row.enablePasswordEncrypted),
    hasSnmpCommunity: Boolean(row.snmpCommunityEncrypted),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function selectOltDeviceSql() {
  return `
    SELECT
      id,
      hubsoftId,
      name,
      manufacturer,
      model,
      pop,
      managementServer,
      host,
      ipv4,
      ipv6,
      username,
      port,
      passwordEncrypted,
      enablePasswordEncrypted,
      useEnableMode,
      driver,
      profileId,
      terminalLengthCommand,
      enterConfigCommand,
      showOnuStateCommand,
      serialLookupCommand,
      rebootOnuCommand,
      saveConfigCommand,
      exitCommands,
      snmpEnabled,
      snmpVersion,
      snmpCommunityEncrypted,
      snmpPort,
      snmpVendor,
      isDefault,
      isActive,
      createdAt,
      updatedAt
    FROM OltDevice
  `
}

export async function listOltDevices() {
  const rows = await prisma.$queryRawUnsafe<OltDeviceRow[]>(`
    ${selectOltDeviceSql()}
    ORDER BY isDefault DESC, name ASC
  `)

  return rows.map(normalizeOltDevice)
}

export async function getDefaultOltDevice(driver?: string): Promise<OltDeviceConnection | null> {
  const rows = driver
    ? await prisma.$queryRawUnsafe<OltDeviceRow[]>(`
        ${selectOltDeviceSql()}
        WHERE isActive = true AND driver = ?
        ORDER BY isDefault DESC, updatedAt DESC
        LIMIT 1
      `, driver)
    : await prisma.$queryRawUnsafe<OltDeviceRow[]>(`
        ${selectOltDeviceSql()}
        WHERE isActive = true
        ORDER BY isDefault DESC, updatedAt DESC
        LIMIT 1
      `)

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    ...normalizeOltDevice(row),
    ...decryptDeviceSecretsForConnection(row),
  }
}

export async function getOltDeviceConnectionById(id: string): Promise<OltDeviceConnection | null> {
  const rows = await prisma.$queryRawUnsafe<OltDeviceRow[]>(`
    ${selectOltDeviceSql()}
    WHERE id = ?
    LIMIT 1
  `, id)

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    ...normalizeOltDevice(row),
    ...decryptDeviceSecretsForConnection(row),
  }
}

export async function getOltSnmpDeviceConnectionById(id: string): Promise<OltSnmpDeviceConnection | null> {
  const rows = await prisma.$queryRaw<Array<Pick<
    OltDeviceRow,
    'id' | 'name' | 'host' | 'ipv4' | 'snmpEnabled' | 'snmpVersion' | 'snmpCommunityEncrypted' | 'snmpPort' | 'snmpVendor' | 'isActive'
  >>>`
    SELECT
      id,
      name,
      host,
      ipv4,
      snmpEnabled,
      snmpVersion,
      snmpCommunityEncrypted,
      snmpPort,
      snmpVendor,
      isActive
    FROM OltDevice
    WHERE id = ${id}
    LIMIT 1
  `

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    id: row.id,
    name: row.name,
    host: row.host,
    ipv4: row.ipv4,
    snmpEnabled: Boolean(row.snmpEnabled),
    snmpVersion: row.snmpVersion || '2c',
    snmpCommunity: row.snmpCommunityEncrypted ? decryptDeviceSecret(row, row.snmpCommunityEncrypted, 'community SNMP') : null,
    snmpPort: row.snmpPort || 161,
    snmpVendor: row.snmpVendor || 'zte_titan',
    isActive: Boolean(row.isActive),
  }
}

export async function getOltDeviceConnectionByHubsoftMetadata(input: {
  hubsoftId?: string | null
  ipv4?: string | null
  name?: string | null
}): Promise<OltDeviceConnection | null> {
  const conditions: string[] = []
  const params: string[] = []

  if (input.hubsoftId) {
    conditions.push('hubsoftId = ?')
    params.push(input.hubsoftId)
  }

  if (input.ipv4) {
    conditions.push('(ipv4 = ? OR host = ?)')
    params.push(input.ipv4, input.ipv4)
  }

  if (input.name) {
    conditions.push('name = ?')
    params.push(input.name)
  }

  if (conditions.length === 0) {
    return null
  }

  const rows = await prisma.$queryRawUnsafe<OltDeviceRow[]>(`
    ${selectOltDeviceSql()}
    WHERE isActive = true AND (${conditions.join(' OR ')})
    ORDER BY isDefault DESC, updatedAt DESC
    LIMIT 1
  `, ...params)

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    ...normalizeOltDevice(row),
    ...decryptDeviceSecretsForConnection(row),
  }
}

export async function upsertOltDevice(input: OltDeviceInput) {
  const id = input.id || randomUUID()
  const isDefault = input.isDefault ?? false
  const isActive = input.isActive ?? true

  if (isDefault) {
    await prisma.$executeRaw`
      UPDATE OltDevice
      SET isDefault = false, updatedAt = CURRENT_TIMESTAMP
      WHERE driver = ${input.driver}
    `
  }

  const currentRows = input.id
    ? await prisma.$queryRaw<OltDeviceRow[]>`
        SELECT * FROM OltDevice WHERE id = ${input.id} LIMIT 1
      `
    : []
  const current = currentRows[0]
  const passwordEncrypted = input.password
    ? encryptSecret(input.password)
    : current?.passwordEncrypted
  const hubsoftId = input.hubsoftId === undefined ? current?.hubsoftId ?? null : input.hubsoftId
  const snmpCommunityEncrypted = input.snmpCommunity === undefined
    ? current?.snmpCommunityEncrypted ?? null
    : input.snmpCommunity
      ? encryptSecret(input.snmpCommunity)
      : null
  const useEnableMode = input.useEnableMode ?? Boolean(current?.useEnableMode)
  const enablePasswordEncrypted = !useEnableMode
    ? null
    : input.enablePassword === undefined
      ? current?.enablePasswordEncrypted ?? null
      : input.enablePassword
        ? encryptSecret(input.enablePassword)
        : null

  if (!passwordEncrypted) {
    throw new Error('Senha SSH da OLT é obrigatória.')
  }

  if ((input.snmpEnabled ?? Boolean(current?.snmpEnabled)) && !snmpCommunityEncrypted) {
    throw new Error('Community SNMP é obrigatória para habilitar a coleta.')
  }

  if (input.id) {
    await prisma.$executeRaw`
      UPDATE OltDevice
      SET
        name = ${input.name},
        hubsoftId = ${hubsoftId},
        manufacturer = ${input.manufacturer},
        model = ${input.model},
        pop = ${input.pop ?? null},
        managementServer = ${input.managementServer ?? null},
        host = ${input.host},
        ipv4 = ${input.ipv4 ?? null},
        ipv6 = ${input.ipv6 ?? null},
        username = ${input.username},
        port = ${input.port},
        passwordEncrypted = ${passwordEncrypted},
        enablePasswordEncrypted = ${enablePasswordEncrypted},
        useEnableMode = ${useEnableMode},
        driver = ${input.driver},
        profileId = ${input.profileId ?? null},
        terminalLengthCommand = ${input.terminalLengthCommand ?? null},
        enterConfigCommand = ${input.enterConfigCommand ?? null},
        showOnuStateCommand = ${input.showOnuStateCommand ?? null},
        serialLookupCommand = ${input.serialLookupCommand ?? null},
        rebootOnuCommand = ${input.rebootOnuCommand ?? null},
        saveConfigCommand = ${input.saveConfigCommand ?? null},
        exitCommands = ${input.exitCommands ?? null},
        snmpEnabled = ${input.snmpEnabled ?? Boolean(current?.snmpEnabled)},
        snmpVersion = ${input.snmpVersion || current?.snmpVersion || '2c'},
        snmpCommunityEncrypted = ${snmpCommunityEncrypted},
        snmpPort = ${input.snmpPort || current?.snmpPort || 161},
        snmpVendor = ${input.snmpVendor || current?.snmpVendor || 'zte_titan'},
        isDefault = ${isDefault},
        isActive = ${isActive},
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${input.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO OltDevice (
        id,
        hubsoftId,
        name,
        manufacturer,
        model,
        pop,
        managementServer,
        host,
        ipv4,
        ipv6,
        username,
        port,
        passwordEncrypted,
        enablePasswordEncrypted,
        useEnableMode,
        driver,
        profileId,
        terminalLengthCommand,
        enterConfigCommand,
        showOnuStateCommand,
        serialLookupCommand,
        rebootOnuCommand,
        saveConfigCommand,
        exitCommands,
        snmpEnabled,
        snmpVersion,
        snmpCommunityEncrypted,
        snmpPort,
        snmpVendor,
        isDefault,
        isActive,
        createdAt,
        updatedAt
      ) VALUES (
        ${id},
        ${hubsoftId},
        ${input.name},
        ${input.manufacturer},
        ${input.model},
        ${input.pop ?? null},
        ${input.managementServer ?? null},
        ${input.host},
        ${input.ipv4 ?? null},
        ${input.ipv6 ?? null},
        ${input.username},
        ${input.port},
        ${passwordEncrypted},
        ${enablePasswordEncrypted},
        ${useEnableMode},
        ${input.driver},
        ${input.profileId ?? null},
        ${input.terminalLengthCommand ?? null},
        ${input.enterConfigCommand ?? null},
        ${input.showOnuStateCommand ?? null},
        ${input.serialLookupCommand ?? null},
        ${input.rebootOnuCommand ?? null},
        ${input.saveConfigCommand ?? null},
        ${input.exitCommands ?? null},
        ${input.snmpEnabled ?? false},
        ${input.snmpVersion || '2c'},
        ${snmpCommunityEncrypted},
        ${input.snmpPort || 161},
        ${input.snmpVendor || 'zte_titan'},
        ${isDefault},
        ${isActive},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `
  }

  const rows = await prisma.$queryRaw<OltDeviceRow[]>`
    SELECT * FROM OltDevice WHERE id = ${id} LIMIT 1
  `

  return rows[0] ? normalizeOltDevice(rows[0]) : null
}
