import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as snmp from 'net-snmp'
import type { OltSnmpDeviceConnection } from './olt-devices'
import { getOltSnmpDeviceConnectionById, isOltSecretDecryptionError } from './olt-devices'
import { prisma } from './prisma'

const execFileAsync = promisify(execFile)

export const ZTE_OLT_OIDS = {
  oltTemperature: '1.3.6.1.4.1.3902.3.6002.2.4.1.3',
  cpu5s: '1.3.6.1.4.1.3902.3.6002.2.1.1.7',
  cpu1m: '1.3.6.1.4.1.3902.3.6002.2.1.1.8',
  cpu5m: '1.3.6.1.4.1.3902.3.6002.2.1.1.9',
  cpuPeak: '1.3.6.1.4.1.3902.3.6002.2.1.1.10',
  physicalMem: '1.3.6.1.4.1.3902.3.6002.2.1.1.5',
  memUsedPercent: '1.3.6.1.4.1.3902.3.6002.2.1.1.6',
  boardTempDesc: '1.3.6.1.4.1.3902.3.6002.2.5.1.6',
  boardTempLocation: '1.3.6.1.4.1.3902.3.6002.2.5.1.7',
  boardSensorStatus: '1.3.6.1.4.1.3902.3.6002.2.5.1.8',
  boardTempCurrent: '1.3.6.1.4.1.3902.3.6002.2.5.1.9',
  boardTempThreshold1: '1.3.6.1.4.1.3902.3.6002.2.5.1.10',
  boardTempThreshold2: '1.3.6.1.4.1.3902.3.6002.2.5.1.11',
  boardTempThreshold3: '1.3.6.1.4.1.3902.3.6002.2.5.1.12',
  boardTempThreshold4: '1.3.6.1.4.1.3902.3.6002.2.5.1.13',
  ztePortName: '1.3.6.1.4.1.3902.3.102.3.1.1.1',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifHcInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHcOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
} as const

type SnmpVarbind = snmp.Varbind
type SnmpSession = snmp.Session
type SnmpCounter = {
  value: bigint | null
  bits: 32 | 64 | null
}
type SnmpCliTarget = {
  host: string
  community: string
  port: number
}

export type OltProcessorSnapshot = {
  processorIndex: string
  character: string
  role: string | null
  cpu5sPercent: number | null
  cpu1mPercent: number | null
  cpu5mPercent: number | null
  peakCpuPercent: number | null
  physicalMemMb: number | null
  freeMemMb: number | null
  memUsedPercent: number | null
}

export type OltTemperatureSnapshot = {
  sensorIndex: string
  board: string | null
  sensor: string | null
  statusCode: number | null
  statusName: string | null
  temperatureC: number | null
  threshold1C: number | null
  threshold2C: number | null
  threshold3C: number | null
  threshold4C: number | null
}

export type OltUplinkSnapshot = {
  ifIndex: number
  interfaceName: string
  operStatus: string
  rxMbps: number | null
  txMbps: number | null
  observation: string | null
}

export type OltSnapshot = {
  oltId: string
  collectedAt: Date
  temperatureC: number | null
  processors: OltProcessorSnapshot[]
  temperatures: OltTemperatureSnapshot[]
  uplinks: OltUplinkSnapshot[]
}

export type OltMonitoringCurrentRow = {
  oltId: string
  oltName: string
  oltHost: string
  temperatureC: number | null
  processorCount: number
  maxCpu5sPercent: number | null
  maxCpu1mPercent: number | null
  maxCpu5mPercent: number | null
  maxMemUsedPercent: number | null
  sensorWarningCount: number
  sensorCriticalCount: number
  uplinkCount: number
  uplinkDownCount: number
  collectedAt: string
  processors: OltProcessorSnapshot[]
  temperatures: OltTemperatureSnapshot[]
  uplinks: OltUplinkSnapshot[]
}

function toInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'bigint') return Number(value)
  if (Buffer.isBuffer(value) && value.length > 0) {
    const parsedBuffer = Number.parseInt(value.toString('utf8'), 10)
    return Number.isFinite(parsedBuffer) ? parsedBuffer : null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function toCounter(value: unknown, bits: 32 | 64): SnmpCounter {
  if (typeof value === 'number' && Number.isFinite(value)) return { value: BigInt(Math.trunc(value)), bits }
  if (typeof value === 'bigint') return { value, bits }
  if (typeof value === 'string') {
    try {
      return { value: BigInt(value.trim()), bits }
    } catch {
      return { value: null, bits: null }
    }
  }
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim()
    if (/^\d+$/.test(text)) return { value: BigInt(text), bits }

    let parsed = BigInt(0)
    for (const byte of value.subarray(-8)) {
      parsed = (parsed * BigInt(256)) + BigInt(byte)
    }
    return { value: parsed, bits }
  }
  return { value: null, bits: null }
}

function toText(value: unknown) {
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim() || null
  if (typeof value === 'string') return value.trim() || null
  if (value === null || value === undefined) return null
  return String(value).trim() || null
}

function suffixIndex(baseOid: string, oid: string) {
  const prefix = `${baseOid}.`
  if (!oid.startsWith(prefix)) return ''
  return oid.slice(prefix.length)
}

function compareDottedIndex(left: string, right: string) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? -1
    const rightValue = rightParts[index] ?? -1
    if (leftValue !== rightValue) return leftValue - rightValue
  }

  return 0
}

function sortedIntegerEntries(values: Map<string, number>) {
  return Array.from(values.entries()).sort(([left], [right]) => compareDottedIndex(left, right))
}

function sortedMapKeys(...values: Array<ReadonlyMap<string, unknown>>) {
  return Array.from(new Set(values.flatMap((item) => Array.from(item.keys())))).sort(compareDottedIndex)
}

function processorMetricValue(
  values: Map<string, number>,
  processorIndex: string,
  processorPosition: number,
  processorCount: number,
) {
  const exactValue = values.get(processorIndex)
  if (exactValue !== undefined) return exactValue

  if (values.size === processorCount) {
    return sortedIntegerEntries(values)[processorPosition]?.[1] ?? null
  }

  return null
}

function snmpErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function retrySnmpOperation<T>(label: string, operation: () => Promise<T>) {
  const attempts = Math.max(1, Number(process.env.OLT_SNMP_OPERATION_ATTEMPTS || 2))
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleep(Number(process.env.OLT_SNMP_RETRY_DELAY_MS || 250))
      }
    }
  }

  throw new Error(`${label}: ${snmpErrorMessage(lastError)}`)
}

function walkSubtree(session: SnmpSession, baseOid: string) {
  return new Promise<SnmpVarbind[]>((resolve, reject) => {
    const result: SnmpVarbind[] = []
    let settled = false
    const timeoutMs = Number(process.env.OLT_SNMP_WALK_TIMEOUT_MS || 20_000)
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timeout SNMP ao consultar ${baseOid} apos ${timeoutMs}ms.`))
    }, timeoutMs)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    session.subtree(
      baseOid,
      Number(process.env.OLT_SNMP_MAX_REPETITIONS || 20),
      (varbinds) => {
        for (const varbind of varbinds) {
          if (snmp.isVarbindError(varbind)) {
            finish(() => reject(new Error(snmp.varbindError(varbind))))
            return true
          }
          result.push(varbind)
        }
        return false
      },
      (error) => {
        if (error) {
          finish(() => reject(error))
          return
        }
        finish(() => resolve(result))
      },
    )
  })
}

function getMany(session: SnmpSession, oids: string[]) {
  if (oids.length === 0) return Promise.resolve([])

  return new Promise<SnmpVarbind[]>((resolve, reject) => {
    let settled = false
    const timeoutMs = Number(process.env.OLT_SNMP_GET_TIMEOUT_MS || 8_000)
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timeout SNMP ao consultar ${oids.length} OID(s) apos ${timeoutMs}ms.`))
    }, timeoutMs)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    session.get(oids, (error, varbinds) => {
      if (error) {
        finish(() => reject(error))
        return
      }
      const errorVarbind = varbinds.find((varbind) => snmp.isVarbindError(varbind))
      if (errorVarbind) {
        finish(() => reject(new Error(snmp.varbindError(errorVarbind))))
        return
      }
      finish(() => resolve(varbinds))
    })
  })
}

async function walkIntegerMap(session: SnmpSession, baseOid: string) {
  const rows = await walkSubtree(session, baseOid)
  const values = new Map<string, number>()
  for (const row of rows) {
    const idx = suffixIndex(baseOid, row.oid)
    const value = toInteger(row.value)
    if (idx && value !== null) values.set(idx, value)
  }
  return values
}

async function walkTextMap(session: SnmpSession, baseOid: string) {
  const rows = await walkSubtree(session, baseOid)
  const values = new Map<string, string>()
  for (const row of rows) {
    const idx = suffixIndex(baseOid, row.oid)
    const value = toText(row.value)
    if (idx && value) values.set(idx, value)
  }
  return values
}

async function optionalIntegerMap(
  session: SnmpSession,
  label: string,
  baseOid: string,
  device: OltSnmpDeviceConnection,
) {
  return retrySnmpOperation(label, () => walkIntegerMap(session, baseOid)).catch((error) => {
    console.warn('[OLT MONITOR] metrica SNMP indisponivel', {
      oltId: device.id,
      oltName: device.name,
      metric: label,
      oid: baseOid,
      error: snmpErrorMessage(error),
    })
    return new Map<string, number>()
  })
}

async function optionalTextMap(
  session: SnmpSession,
  label: string,
  baseOid: string,
  device: OltSnmpDeviceConnection,
) {
  return retrySnmpOperation(label, () => walkTextMap(session, baseOid)).catch((error) => {
    console.warn('[OLT MONITOR] metrica SNMP indisponivel', {
      oltId: device.id,
      oltName: device.name,
      metric: label,
      oid: baseOid,
      error: snmpErrorMessage(error),
    })
    return new Map<string, string>()
  })
}

function processorCharacter(index: string) {
  const [, , slot, cpu] = index.split('.')
  const slotNumber = slot || index
  const cpuNumber = cpu || '0'
  return slotNumber === '6' ? `MPU-1/${slotNumber}/${cpuNumber}` : `PFU-1/${slotNumber}/${cpuNumber}`
}

function processorRole(index: string) {
  const [, , slot] = index.split('.')
  return slot === '6' ? 'MSC' : 'N/A'
}

function calcFreeMem(physicalMemMb: number | null, memUsedPercent: number | null) {
  if (physicalMemMb === null || memUsedPercent === null) return null
  return Math.round(physicalMemMb - ((physicalMemMb * memUsedPercent) / 100))
}

function sensorStatusName(code: number | null) {
  if (code === 1) return 'normal'
  if (code === 2) return 'warning'
  if (code === 3) return 'critical'
  if (code === 4) return 'shutdown'
  return 'unknown'
}

function operStatusName(code: number | null) {
  const map: Record<number, string> = {
    1: 'up',
    2: 'down',
    3: 'testing',
    4: 'unknown',
    5: 'dormant',
    6: 'notPresent',
    7: 'lowerLayerDown',
  }
  return code ? map[code] ?? 'unknown' : 'unknown'
}

function isOperDown(status: string) {
  return ['down', 'testing', 'dormant', 'notPresent', 'lowerLayerDown'].includes(status)
}

function isUplinkName(value: string) {
  return /(xgei|xei|gei|uplink)/i.test(value)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function maxNumber(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length ? Math.max(...numbers) : null
}

function emptyCounter(): SnmpCounter {
  return { value: null, bits: null }
}

function counterDeltaMbps(before: SnmpCounter | null, after: SnmpCounter | null, intervalSeconds: number) {
  if (before?.value === null || before?.value === undefined || after?.value === null || after?.value === undefined || intervalSeconds <= 0) return null
  if (before.bits !== after.bits || before.bits === null) return null

  let delta = after.value - before.value
  if (delta < BigInt(0) && before.bits === 32) {
    delta = (BigInt(2) ** BigInt(32)) - before.value + after.value
  }
  if (delta < BigInt(0)) return null

  return Number(((Number(delta) * 8) / intervalSeconds / 1_000_000).toFixed(2))
}

function snmpgetOutputToCounter(value: string, bits: 32 | 64): SnmpCounter {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return emptyCounter()
  return { value: BigInt(text), bits }
}

async function collectCountersViaSnmpget(target: SnmpCliTarget, ifIndexes: number[], baseOid: string, bits: 32 | 64) {
  const result = new Map<number, SnmpCounter>()
  if (ifIndexes.length === 0) return result

  const agent = target.port === 161 ? target.host : `${target.host}:${target.port}`
  const { stdout } = await execFileAsync('snmpget', [
    '-Oqv',
    '-v2c',
    '-c',
    target.community,
    agent,
    ...ifIndexes.map((ifIndex) => `${baseOid}.${ifIndex}`),
  ], {
    timeout: Number(process.env.OLT_SNMP_COUNTER_CLI_TIMEOUT_MS || 8_000),
    maxBuffer: 1024 * 1024,
  })
  const lines = stdout.trim().split(/\r?\n/)
  for (let index = 0; index < ifIndexes.length; index += 1) {
    result.set(ifIndexes[index], snmpgetOutputToCounter(lines[index] ?? '', bits))
  }

  return result
}

async function collectCounters(session: SnmpSession, ifIndexes: number[], direction: 'in' | 'out', cliTarget?: SnmpCliTarget) {
  const primaryBase = direction === 'in' ? ZTE_OLT_OIDS.ifHcInOctets : ZTE_OLT_OIDS.ifHcOutOctets
  const fallbackBase = direction === 'in' ? ZTE_OLT_OIDS.ifInOctets : ZTE_OLT_OIDS.ifOutOctets
  const result = new Map<number, SnmpCounter>()

  const primaryByCli = cliTarget ? await collectCountersViaSnmpget(cliTarget, ifIndexes, primaryBase, 64).catch(() => null) : null
  if (primaryByCli) {
    for (const ifIndex of ifIndexes) {
      result.set(ifIndex, primaryByCli.get(ifIndex) ?? emptyCounter())
    }
  }

  const primaryMissingIndexes = ifIndexes.filter((ifIndex) => result.get(ifIndex)?.value === null || result.get(ifIndex)?.value === undefined)
  const primary = primaryMissingIndexes.length
    ? await getMany(session, primaryMissingIndexes.map((ifIndex) => `${primaryBase}.${ifIndex}`)).catch(() => [])
    : []

  for (let index = 0; index < primaryMissingIndexes.length; index += 1) {
    result.set(primaryMissingIndexes[index], toCounter(primary[index]?.value, 64))
  }

  const fallbackIndexes = ifIndexes.filter((ifIndex) => result.get(ifIndex)?.value === null)
  if (fallbackIndexes.length) {
    const fallbackByCli = cliTarget ? await collectCountersViaSnmpget(cliTarget, fallbackIndexes, fallbackBase, 32).catch(() => null) : null
    if (fallbackByCli) {
      for (const ifIndex of fallbackIndexes) {
        result.set(ifIndex, fallbackByCli.get(ifIndex) ?? emptyCounter())
      }
    }

    const fallbackMissingIndexes = fallbackIndexes.filter((ifIndex) => result.get(ifIndex)?.value === null || result.get(ifIndex)?.value === undefined)
    const fallback = fallbackMissingIndexes.length
      ? await getMany(session, fallbackMissingIndexes.map((ifIndex) => `${fallbackBase}.${ifIndex}`)).catch(() => [])
      : []
    for (let index = 0; index < fallbackMissingIndexes.length; index += 1) {
      result.set(fallbackMissingIndexes[index], toCounter(fallback[index]?.value, 32))
    }
  }

  return result
}

async function collectUplinks(session: SnmpSession, trafficIntervalSeconds: number, cliTarget?: SnmpCliTarget): Promise<OltUplinkSnapshot[]> {
  const portNames = await walkTextMap(session, ZTE_OLT_OIDS.ztePortName).catch(() => new Map<string, string>())
  const discovered = Array.from(portNames.entries())
    .map(([index, name]) => ({ ifIndex: Number(index), interfaceName: name.replace(/^"|"$/g, '') }))
    .filter((item) => Number.isInteger(item.ifIndex) && isUplinkName(item.interfaceName))

  if (discovered.length === 0) return []

  const statusVarbinds = await getMany(
    session,
    discovered.map((item) => `${ZTE_OLT_OIDS.ifOperStatus}.${item.ifIndex}`),
  ).catch(() => [])
  const statuses = new Map<number, string>()
  for (let index = 0; index < discovered.length; index += 1) {
    statuses.set(discovered[index].ifIndex, operStatusName(toInteger(statusVarbinds[index]?.value)))
  }

  const active = discovered.filter((item) => !isOperDown(statuses.get(item.ifIndex) ?? 'unknown'))
  const inBefore = await collectCounters(session, active.map((item) => item.ifIndex), 'in', cliTarget)
  const outBefore = await collectCounters(session, active.map((item) => item.ifIndex), 'out', cliTarget)
  if (active.length) {
    await sleep(trafficIntervalSeconds * 1000)
  }
  const inAfter = await collectCounters(session, active.map((item) => item.ifIndex), 'in', cliTarget)
  const outAfter = await collectCounters(session, active.map((item) => item.ifIndex), 'out', cliTarget)

  return discovered.map((item) => {
    const operStatus = statuses.get(item.ifIndex) ?? 'unknown'
    if (isOperDown(operStatus)) {
      return {
        ...item,
        operStatus,
        rxMbps: 0,
        txMbps: 0,
        observation: 'porta_inativa_sem_coleta_de_trafego',
      }
    }

    const rxMbps = counterDeltaMbps(inBefore.get(item.ifIndex) ?? emptyCounter(), inAfter.get(item.ifIndex) ?? emptyCounter(), trafficIntervalSeconds)
    const txMbps = counterDeltaMbps(outBefore.get(item.ifIndex) ?? emptyCounter(), outAfter.get(item.ifIndex) ?? emptyCounter(), trafficIntervalSeconds)
    const missingMetrics = [
      rxMbps === null ? 'rx_indisponivel' : null,
      txMbps === null ? 'tx_indisponivel' : null,
    ].filter(Boolean).join('_')

    return {
      ...item,
      operStatus: operStatus === 'up' ? 'up' : ((rxMbps ?? 0) > 0 || (txMbps ?? 0) > 0 ? 'active' : 'idle/down'),
      rxMbps,
      txMbps,
      observation: missingMetrics || (operStatus === 'up' ? 'porta_up_coleta_realizada' : 'status_inferido_por_contador'),
    }
  })
}

export async function collectOltMetricsViaSnmp(device: OltSnmpDeviceConnection, trafficIntervalSeconds = 5): Promise<OltSnapshot> {
  if (!device.snmpEnabled) {
    throw new Error(`SNMP da OLT ${device.name} nao esta habilitado.`)
  }

  if (device.snmpVersion !== '2c') {
    throw new Error(`A OLT ${device.name} esta configurada com SNMP ${device.snmpVersion}; esta coleta suporta SNMP v2c.`)
  }

  if (!device.snmpCommunity) {
    throw new Error(`Configure a community SNMP da OLT ${device.name}.`)
  }

  const target = device.ipv4 || device.host
  const session = snmp.createSession(target, device.snmpCommunity, {
    port: device.snmpPort || 161,
    version: snmp.Version2c,
    retries: Number(process.env.OLT_SNMP_RETRIES || 1),
    timeout: Number(process.env.OLT_SNMP_TIMEOUT_MS || 5000),
  })

  try {
    const oltTemperatures = await optionalIntegerMap(session, 'temperatura OLT', ZTE_OLT_OIDS.oltTemperature, device)
    const cpu5s = await optionalIntegerMap(session, 'CPU 5s', ZTE_OLT_OIDS.cpu5s, device)
    const cpu1m = await optionalIntegerMap(session, 'CPU 1m', ZTE_OLT_OIDS.cpu1m, device)
    const cpu5m = await optionalIntegerMap(session, 'CPU 5m', ZTE_OLT_OIDS.cpu5m, device)
    const peak = await optionalIntegerMap(session, 'CPU pico', ZTE_OLT_OIDS.cpuPeak, device)
    const physicalMem = await optionalIntegerMap(session, 'memoria fisica', ZTE_OLT_OIDS.physicalMem, device)
    const memUsed = await optionalIntegerMap(session, 'memoria usada', ZTE_OLT_OIDS.memUsedPercent, device)
    const boards = await optionalTextMap(session, 'placa sensor', ZTE_OLT_OIDS.boardTempDesc, device)
    const sensors = await optionalTextMap(session, 'local sensor', ZTE_OLT_OIDS.boardTempLocation, device)
    const sensorStatus = await optionalIntegerMap(session, 'status sensor', ZTE_OLT_OIDS.boardSensorStatus, device)
    const sensorTemps = await optionalIntegerMap(session, 'temperatura sensor', ZTE_OLT_OIDS.boardTempCurrent, device)
    const threshold1 = await optionalIntegerMap(session, 'limite temperatura 1', ZTE_OLT_OIDS.boardTempThreshold1, device)
    const threshold2 = await optionalIntegerMap(session, 'limite temperatura 2', ZTE_OLT_OIDS.boardTempThreshold2, device)
    const threshold3 = await optionalIntegerMap(session, 'limite temperatura 3', ZTE_OLT_OIDS.boardTempThreshold3, device)
    const threshold4 = await optionalIntegerMap(session, 'limite temperatura 4', ZTE_OLT_OIDS.boardTempThreshold4, device)

    const processorIndexes = sortedMapKeys(cpu5s, cpu1m, cpu5m, peak, physicalMem, memUsed)
    const processors = processorIndexes.map((processorIndex, processorPosition) => {
      const physicalMemMb = physicalMem.get(processorIndex) ?? null
      const memUsedPercent = memUsed.get(processorIndex) ?? null
      return {
        processorIndex,
        character: processorCharacter(processorIndex),
        role: processorRole(processorIndex),
        cpu5sPercent: cpu5s.get(processorIndex) ?? null,
        cpu1mPercent: processorMetricValue(cpu1m, processorIndex, processorPosition, processorIndexes.length),
        cpu5mPercent: processorMetricValue(cpu5m, processorIndex, processorPosition, processorIndexes.length),
        peakCpuPercent: peak.get(processorIndex) ?? null,
        physicalMemMb,
        freeMemMb: calcFreeMem(physicalMemMb, memUsedPercent),
        memUsedPercent,
      }
    })

    const temperatureIndexes = sortedMapKeys(boards, sensors, sensorStatus, sensorTemps, threshold1, threshold2, threshold3, threshold4)
    const temperatures = temperatureIndexes.map((sensorIndex) => {
      const statusCode = sensorStatus.get(sensorIndex) ?? null
      return {
        sensorIndex,
        board: boards.get(sensorIndex) ?? null,
        sensor: sensors.get(sensorIndex) ?? null,
        statusCode,
        statusName: sensorStatusName(statusCode),
        temperatureC: sensorTemps.get(sensorIndex) ?? null,
        threshold1C: threshold1.get(sensorIndex) ?? null,
        threshold2C: threshold2.get(sensorIndex) ?? null,
        threshold3C: threshold3.get(sensorIndex) ?? null,
        threshold4C: threshold4.get(sensorIndex) ?? null,
      }
    })

    const uplinks = await collectUplinks(session, trafficIntervalSeconds, {
      host: target,
      community: device.snmpCommunity,
      port: device.snmpPort || 161,
    })
    const collectedAt = new Date()

    return {
      oltId: device.id,
      collectedAt,
      temperatureC: maxNumber(Array.from(oltTemperatures.values())),
      processors,
      temperatures,
      uplinks,
    }
  } finally {
    session.close()
  }
}

function snapshotSummary(snapshot: OltSnapshot) {
  return {
    temperatureC: snapshot.temperatureC,
    processorCount: snapshot.processors.length,
    maxCpu5sPercent: maxNumber(snapshot.processors.map((item) => item.cpu5sPercent)),
    maxCpu1mPercent: maxNumber(snapshot.processors.map((item) => item.cpu1mPercent)),
    maxCpu5mPercent: maxNumber(snapshot.processors.map((item) => item.cpu5mPercent)),
    maxMemUsedPercent: maxNumber(snapshot.processors.map((item) => item.memUsedPercent)),
    sensorWarningCount: snapshot.temperatures.filter((item) => item.statusName === 'warning').length,
    sensorCriticalCount: snapshot.temperatures.filter((item) => item.statusName === 'critical' || item.statusName === 'shutdown').length,
    uplinkCount: snapshot.uplinks.length,
    uplinkDownCount: snapshot.uplinks.filter((item) => isOperDown(item.operStatus) || item.operStatus === 'idle/down').length,
  }
}

export async function saveOltSnapshot(snapshot: OltSnapshot) {
  const summary = snapshotSummary(snapshot)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "OltHealthCurrent" (
        "id", "oltId", "temperatureC", "processorCount", "maxCpu5sPercent", "maxCpu1mPercent", "maxCpu5mPercent",
        "maxMemUsedPercent", "sensorWarningCount", "sensorCriticalCount", "uplinkCount", "uplinkDownCount", "collectedAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${snapshot.oltId}, ${summary.temperatureC}, ${summary.processorCount}, ${summary.maxCpu5sPercent}, ${summary.maxCpu1mPercent},
        ${summary.maxCpu5mPercent}, ${summary.maxMemUsedPercent}, ${summary.sensorWarningCount}, ${summary.sensorCriticalCount},
        ${summary.uplinkCount}, ${summary.uplinkDownCount}, ${snapshot.collectedAt}, CURRENT_TIMESTAMP
      )
      ON CONFLICT("oltId") DO UPDATE SET
        "temperatureC" = excluded."temperatureC",
        "processorCount" = excluded."processorCount",
        "maxCpu5sPercent" = excluded."maxCpu5sPercent",
        "maxCpu1mPercent" = excluded."maxCpu1mPercent",
        "maxCpu5mPercent" = excluded."maxCpu5mPercent",
        "maxMemUsedPercent" = excluded."maxMemUsedPercent",
        "sensorWarningCount" = excluded."sensorWarningCount",
        "sensorCriticalCount" = excluded."sensorCriticalCount",
        "uplinkCount" = excluded."uplinkCount",
        "uplinkDownCount" = excluded."uplinkDownCount",
        "collectedAt" = excluded."collectedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `

    await tx.$executeRaw`
      INSERT INTO "OltHealthHistory" (
        "id", "oltId", "temperatureC", "processorCount", "maxCpu5sPercent", "maxCpu1mPercent", "maxCpu5mPercent",
        "maxMemUsedPercent", "sensorWarningCount", "sensorCriticalCount", "uplinkCount", "uplinkDownCount", "collectedAt"
      ) VALUES (
        ${randomUUID()}, ${snapshot.oltId}, ${summary.temperatureC}, ${summary.processorCount}, ${summary.maxCpu5sPercent}, ${summary.maxCpu1mPercent},
        ${summary.maxCpu5mPercent}, ${summary.maxMemUsedPercent}, ${summary.sensorWarningCount}, ${summary.sensorCriticalCount},
        ${summary.uplinkCount}, ${summary.uplinkDownCount}, ${snapshot.collectedAt}
      )
    `

    await tx.$executeRaw`DELETE FROM "OltProcessorCurrent" WHERE "oltId" = ${snapshot.oltId}`
    await tx.$executeRaw`DELETE FROM "OltTemperatureCurrent" WHERE "oltId" = ${snapshot.oltId}`
    await tx.$executeRaw`DELETE FROM "OltUplinkCurrent" WHERE "oltId" = ${snapshot.oltId}`

    for (const processor of snapshot.processors) {
      await tx.$executeRaw`
        INSERT INTO "OltProcessorCurrent" (
          "id", "oltId", "processorIndex", "character", "role", "cpu5sPercent", "cpu1mPercent", "cpu5mPercent",
          "peakCpuPercent", "physicalMemMb", "freeMemMb", "memUsedPercent", "collectedAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${snapshot.oltId}, ${processor.processorIndex}, ${processor.character}, ${processor.role},
          ${processor.cpu5sPercent}, ${processor.cpu1mPercent}, ${processor.cpu5mPercent}, ${processor.peakCpuPercent},
          ${processor.physicalMemMb}, ${processor.freeMemMb}, ${processor.memUsedPercent}, ${snapshot.collectedAt}, CURRENT_TIMESTAMP
        )
      `
    }

    for (const temperature of snapshot.temperatures) {
      await tx.$executeRaw`
        INSERT INTO "OltTemperatureCurrent" (
          "id", "oltId", "sensorIndex", "board", "sensor", "statusCode", "statusName", "temperatureC",
          "threshold1C", "threshold2C", "threshold3C", "threshold4C", "collectedAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${snapshot.oltId}, ${temperature.sensorIndex}, ${temperature.board}, ${temperature.sensor},
          ${temperature.statusCode}, ${temperature.statusName}, ${temperature.temperatureC}, ${temperature.threshold1C},
          ${temperature.threshold2C}, ${temperature.threshold3C}, ${temperature.threshold4C}, ${snapshot.collectedAt}, CURRENT_TIMESTAMP
        )
      `
    }

    for (const uplink of snapshot.uplinks) {
      await tx.$executeRaw`
        INSERT INTO "OltUplinkCurrent" (
          "id", "oltId", "ifIndex", "interfaceName", "operStatus", "rxMbps", "txMbps", "observation", "collectedAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${snapshot.oltId}, ${uplink.ifIndex}, ${uplink.interfaceName}, ${uplink.operStatus},
          ${uplink.rxMbps}, ${uplink.txMbps}, ${uplink.observation}, ${snapshot.collectedAt}, CURRENT_TIMESTAMP
        )
      `
    }
  })

  return summary
}

export async function listSnmpEnabledOltMetricDevices() {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "OltDevice"
    WHERE "isActive" = true AND "snmpEnabled" = true
    ORDER BY "isDefault" DESC, "name" ASC
  `
  const devices: OltSnmpDeviceConnection[] = []

  for (const row of rows) {
    try {
      const device = await getOltSnmpDeviceConnectionById(row.id)
      if (device) {
        devices.push(device)
      }
    } catch (error) {
      if (!isOltSecretDecryptionError(error)) {
        throw error
      }

      console.error('[OLT MONITOR] OLT ignorada por credencial criptografada invalida', {
        oltId: error.oltId,
        oltName: error.oltName || row.name,
        field: error.field,
        message: error.message,
      })
    }
  }

  return devices
}

function dbDate(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  return null
}

export async function listOltMonitoringCurrent(): Promise<OltMonitoringCurrentRow[]> {
  const healthRows = await prisma.$queryRaw<Array<Omit<OltMonitoringCurrentRow, 'processors' | 'temperatures' | 'uplinks' | 'collectedAt'> & { collectedAt: Date | string }>>`
    SELECT
      "OltHealthCurrent"."oltId",
      "OltDevice"."name" AS "oltName",
      "OltDevice"."host" AS "oltHost",
      "OltHealthCurrent"."temperatureC",
      "OltHealthCurrent"."processorCount",
      "OltHealthCurrent"."maxCpu5sPercent",
      "OltHealthCurrent"."maxCpu1mPercent",
      "OltHealthCurrent"."maxCpu5mPercent",
      "OltHealthCurrent"."maxMemUsedPercent",
      "OltHealthCurrent"."sensorWarningCount",
      "OltHealthCurrent"."sensorCriticalCount",
      "OltHealthCurrent"."uplinkCount",
      "OltHealthCurrent"."uplinkDownCount",
      "OltHealthCurrent"."collectedAt"
    FROM "OltHealthCurrent"
    INNER JOIN "OltDevice" ON "OltDevice"."id" = "OltHealthCurrent"."oltId"
    ORDER BY "OltDevice"."name" ASC
  `

  const processors = await prisma.$queryRaw<Array<OltProcessorSnapshot & { oltId: string }>>`
    SELECT "oltId", "processorIndex", "character", "role", "cpu5sPercent", "cpu1mPercent", "cpu5mPercent", "peakCpuPercent", "physicalMemMb", "freeMemMb", "memUsedPercent"
    FROM "OltProcessorCurrent"
    ORDER BY "character" ASC
  `
  const temperatures = await prisma.$queryRaw<Array<OltTemperatureSnapshot & { oltId: string }>>`
    SELECT "oltId", "sensorIndex", "board", "sensor", "statusCode", "statusName", "temperatureC", "threshold1C", "threshold2C", "threshold3C", "threshold4C"
    FROM "OltTemperatureCurrent"
    ORDER BY "sensorIndex" ASC
  `
  const uplinks = await prisma.$queryRaw<Array<OltUplinkSnapshot & { oltId: string }>>`
    SELECT "oltId", "ifIndex", "interfaceName", "operStatus", "rxMbps", "txMbps", "observation"
    FROM "OltUplinkCurrent"
    ORDER BY "interfaceName" ASC
  `

  return healthRows.map((row) => ({
    ...row,
    collectedAt: dbDate(row.collectedAt) ?? new Date().toISOString(),
    processors: processors.filter((item) => item.oltId === row.oltId).map(stripOltId),
    temperatures: temperatures.filter((item) => item.oltId === row.oltId).map(stripOltId),
    uplinks: uplinks.filter((item) => item.oltId === row.oltId).map(stripOltId),
  }))
}

function stripOltId<Row extends { oltId: string }>(row: Row): Omit<Row, 'oltId'> {
  const { oltId, ...rest } = row
  void oltId
  return rest
}

export async function getOltMonitoringSummary() {
  const rows = await listOltMonitoringCurrent()
  const highCpu = rows.filter((row) => (row.maxCpu5sPercent ?? row.maxCpu1mPercent ?? 0) >= 80).length
  const highMemory = rows.filter((row) => (row.maxMemUsedPercent ?? 0) >= 80).length
  const sensorAlerts = rows.reduce((total, row) => total + row.sensorWarningCount + row.sensorCriticalCount, 0)
  const uplinkDown = rows.reduce((total, row) => total + row.uplinkDownCount, 0)

  return {
    total: rows.length,
    highCpu,
    highMemory,
    sensorAlerts,
    uplinkDown,
  }
}

export async function deleteOldOltHealthHistory(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  await prisma.$executeRaw`
    DELETE FROM "OltHealthHistory"
    WHERE "collectedAt" < ${cutoff}
  `
}
