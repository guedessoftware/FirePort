import type { OltDeviceConnection } from './olt-devices'
import { executeOltCommandsOverSsh } from './olt-ssh'

export const MAX_ONU_POSITIONS = 128

export type OltOnuPositions = {
  totalPositions: number
  occupiedPositions: number[]
  freePositions: number[]
  nextFreePosition: number | null
  isRecognizedOutput: boolean
  reportedOccupiedCount: number | null
  reportedConfiguredCount: number | null
}

export type OltSerialLookupResult = {
  command: string
  output: string
  stderr: string
  exists: boolean
  isRecognizedOutput: boolean
  matchedLines: string[]
  matchedPosition: {
    chassi: number
    slot: number
    pon: number
    onuId: number
  } | null
}

export function parseConfiguredOnuPositions(output: string): OltOnuPositions {
  const positions = new Set<number>()
  const onuNumberMatch = output.match(/ONU\s+Number:\s*(\d+)\s*\/\s*(\d+)/i)
  const reportedOccupiedCount = onuNumberMatch ? Number(onuNumberMatch[1]) : null
  const reportedConfiguredCount = onuNumberMatch ? Number(onuNumberMatch[2]) : null
  const totalPositions = MAX_ONU_POSITIONS

  for (const match of output.matchAll(/\b\d+\/\d+\/\d+:(\d+)\s+(?:enable|disable)\s+(?:enable|disable)\s+\S+/gi)) {
    const position = Number(match[1])

    if (Number.isInteger(position) && position >= 1 && position <= totalPositions) {
      positions.add(position)
    }
  }

  const occupiedPositions = Array.from(positions).sort((left, right) => left - right)
  const freePositions = Array.from({ length: totalPositions }, (_item, index) => index + 1)
    .filter((position) => !positions.has(position))
  const parsedAllReportedPositions = reportedConfiguredCount === null || occupiedPositions.length >= reportedConfiguredCount

  return {
    totalPositions,
    occupiedPositions,
    freePositions,
    nextFreePosition: parsedAllReportedPositions ? freePositions[0] ?? null : null,
    isRecognizedOutput: /OnuIndex|ONU Number/i.test(output),
    reportedOccupiedCount,
    reportedConfiguredCount,
  }
}

export function getOltOnuStateCommand(chassi: string | number, slot: string | number, pon: string | number) {
  return `show gpon onu state gpon_olt-${chassi}/${slot}/${pon}`
}

function renderOltCommandTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  const normalizedValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)]),
  )

  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => normalizedValues[key] ?? '')
    .replace(/\[\[\s*([\w.]+)\s*\]\]/g, (_match, key: string) => normalizedValues[key] ?? '')
}

function normalizeSerial(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseOltSerialLookup(output: string, serial: string, command: string) {
  const normalizedSerial = normalizeSerial(serial)
  const outputWithoutCommand = output.replace(new RegExp(escapeRegExp(command), 'i'), '')
  const onuPositionPattern = /\b(?:gpon[-_](?:onu|ont)[-_])?(\d+)\/(\d+)\/(\d+):(\d+)\b/i
  const lines = outputWithoutCommand
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const negativeOutput = lines.some((line) => /not\s+found|not\s+exist|not\s+exists|no\s+(onu|ont|data|record|entry|matching|related|such)|not\s+online|does\s+not\s+exist/i.test(line))
  const matchedLines = lines.filter((line) => normalizeSerial(line).includes(normalizedSerial) || onuPositionPattern.test(line))
  const matchedPositionLine = matchedLines.find((line) => onuPositionPattern.test(line))
  const positionMatch = matchedPositionLine?.match(onuPositionPattern)
  const hasCliError = lines.some((line) => /^%Error\b/i.test(line))

  return {
    exists: !negativeOutput && matchedLines.length > 0,
    isRecognizedOutput: hasCliError || negativeOutput || matchedLines.length > 0,
    matchedLines,
    matchedPosition: positionMatch
      ? {
          chassi: Number(positionMatch[1]),
          slot: Number(positionMatch[2]),
          pon: Number(positionMatch[3]),
          onuId: Number(positionMatch[4]),
        }
      : null,
  }
}

export function getOltSerialLookupCommand(serial: string) {
  return `show gpon onu by sn ${serial}`
}

export function getOltOnuRebootCommands(position: {
  chassi: string | number
  slot: string | number
  pon: string | number
  onuId: string | number
}) {
  return [
    'configure terminal',
    `pon-onu-mng gpon_onu-${position.chassi}/${position.slot}/${position.pon}:${position.onuId}`,
    'reboot',
    'yes',
  ].join('\n')
}

function getNavigationCommands(device: OltDeviceConnection) {
  return [
    device.terminalLengthCommand || 'terminal length 0',
    device.enterConfigCommand || 'conf t',
  ].map((item) => item.trim()).filter(Boolean)
}

function maskIdentifier(value: string) {
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}****${value.slice(-4)}`
}

function maskCommandValue(command: string, value: string) {
  return command.split(value).join(maskIdentifier(value))
}

function splitOperationalCommands(commands?: string | null) {
  if (!commands) {
    return []
  }

  return commands
    .split(/[\r\n,]+/)
    .map((command) => command.trim())
    .filter(Boolean)
}

function splitCommandBlock(commands?: string | null) {
  if (!commands) {
    return []
  }

  return commands
    .split(/\r?\n/)
    .map((command) => command.trim())
    .filter(Boolean)
}

function shouldLogOltManagementDebug() {
  return process.env.OLT_MANAGEMENT_DEBUG === 'true'
}

export async function queryOltOnuBySerial(
  device: OltDeviceConnection,
  serial: string,
): Promise<OltSerialLookupResult> {
  const command = renderOltCommandTemplate(
    device.serialLookupCommand || getOltSerialLookupCommand(serial),
    { serial, phy_addr: serial },
  )
  if (shouldLogOltManagementDebug()) {
    console.log('[OLT SERIAL LOOKUP] consultando ONU por serial', {
      device: device.name,
      host: device.host || device.ipv4,
      serial: maskIdentifier(serial),
      command: maskCommandValue(command, serial),
    })
  }
  const result = await executeOltCommandsOverSsh(device, [...getNavigationCommands(device), command], {
    retries: Math.max(0, Number(process.env.OLT_SERIAL_LOOKUP_RETRIES || 1)),
    allowPartialOnDisconnect: true,
    exitCommands: splitOperationalCommands(device.exitCommands),
  })
  const parsed = parseOltSerialLookup(result.output, serial, command)
  if (shouldLogOltManagementDebug()) {
    console.log('[OLT SERIAL LOOKUP] consulta concluida', {
      device: device.name,
      serial: maskIdentifier(serial),
      command: maskCommandValue(command, serial),
      exists: parsed.exists,
      recognizedOutput: parsed.isRecognizedOutput,
      matchedLines: parsed.matchedLines.length,
      matchedPosition: parsed.matchedPosition,
    })
  }

  return {
    command,
    output: result.output,
    stderr: result.stderr,
    ...parsed,
  }
}

export async function rebootOltOnu(
  device: OltDeviceConnection,
  position: { chassi: string | number; slot: string | number; pon: string | number; onuId: string | number },
) {
  const templateValues = {
    ...position,
    onu_id: position.onuId,
    indice_onu: position.onuId,
  }
  const commandBlock = renderOltCommandTemplate(
    device.rebootOnuCommand || getOltOnuRebootCommands(position),
    templateValues,
  )
  const commands = [
    device.terminalLengthCommand || 'terminal length 0',
    ...splitCommandBlock(commandBlock),
  ].map((command) => command.trim()).filter(Boolean)
  const retries = Math.max(0, Number(process.env.OLT_ONU_REBOOT_RETRIES || 0))

  if (shouldLogOltManagementDebug()) {
    console.log('[OLT ONU REBOOT] reiniciando ONU', {
      device: device.name,
      host: device.host || device.ipv4,
      position,
      commandCount: commands.length,
      retries,
    })
  }
  const result = await executeOltCommandsOverSsh(device, commands, {
    retries,
    allowPartialOnDisconnect: true,
    stopOnCliError: true,
    exitCommands: splitOperationalCommands(device.exitCommands),
  })

  if (shouldLogOltManagementDebug()) {
    console.log('[OLT ONU REBOOT] comando finalizado', {
      device: device.name,
      position,
      stdoutChars: result.output.length,
      stderrChars: result.stderr.length,
    })
  }

  return {
    commands,
    output: result.output,
    stderr: result.stderr,
  }
}

export async function queryOltOnuState(
  device: OltDeviceConnection,
  position: { chassi: string | number; slot: string | number; pon: string | number },
) {
  const command = renderOltCommandTemplate(
    device.showOnuStateCommand || getOltOnuStateCommand(position.chassi, position.slot, position.pon),
    position,
  )
  const navigationCommands = getNavigationCommands(device)
  const retries = Math.max(0, Number(process.env.OLT_ONU_STATE_RETRIES || 2))
  if (shouldLogOltManagementDebug()) {
    console.log('[OLT ONU STATE] consultando posicoes da PON', {
      device: device.name,
      host: device.host || device.ipv4,
      position,
      command,
      retries,
    })
  }
  const result = await executeOltCommandsOverSsh(device, [...navigationCommands, command], {
    retries,
    allowPartialOnDisconnect: true,
    exitCommands: splitOperationalCommands(device.exitCommands),
  })
  const positions = parseConfiguredOnuPositions(result.output)
  if (shouldLogOltManagementDebug()) {
    console.log('[OLT ONU STATE] consulta concluida', {
      device: device.name,
      position,
      command,
      stdoutChars: result.output.length,
      stderrChars: result.stderr.length,
      recognizedOutput: positions.isRecognizedOutput,
      reportedOccupiedCount: positions.reportedOccupiedCount,
      reportedConfiguredCount: positions.reportedConfiguredCount,
      occupiedCount: positions.occupiedPositions.length,
      nextFreePosition: positions.nextFreePosition,
    })
  }

  return {
    command,
    output: result.output,
    stderr: result.stderr,
    positions,
  }
}
