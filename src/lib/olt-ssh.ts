import type { OltDeviceConnection } from './olt-devices'

type SshClient = {
  on(event: string, callback: (...args: unknown[]) => void): SshClient
  connect(config: Record<string, unknown>): void
  shell(callback: (error: Error | undefined, stream: SshStream) => void): void
  end(): void
}

type SshStream = {
  on(event: string, callback: (...args: unknown[]) => void): SshStream
  stderr?: {
    on(event: string, callback: (...args: unknown[]) => void): void
  }
  write(data: string): void
  end(data?: string): void
}

type ExecuteOltSshOptions = {
  retries?: number
  retryDelayMs?: number
  allowPartialOnDisconnect?: boolean
  stopOnCliError?: boolean
  exitCommands?: string[]
}

type OltCommandError = Error & {
  outputExcerpt?: string
}

function loadSshClient(): { Client: new () => SshClient } {
  try {
    // ssh2 is optional at type-check time, but required at runtime for OLT access.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ssh2') as { Client: new () => SshClient }
  } catch {
    throw new Error('Dependência ssh2 não instalada. Execute npm install para habilitar conexão SSH com OLT.')
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getSshLogId(device: OltDeviceConnection) {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${device.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now().toString(36)}-${suffix}`
}

function getSshLogSecrets(device: OltDeviceConnection) {
  return [device.password, device.enablePassword].filter((secret): secret is string => Boolean(secret))
}

function sanitizeSshLogText(value: string, secrets: string[]) {
  return secrets.reduce((current, secret) => current.split(secret).join('[senha ocultada]'), value)
}

function formatSshLogText(value: string, secrets: string[]) {
  const sanitized = sanitizeSshLogText(value, secrets)
  const maxLength = Number(process.env.OLT_SSH_LOG_MAX_CHARS || 8000)

  if (!Number.isFinite(maxLength) || maxLength <= 0 || sanitized.length <= maxLength) {
    return sanitized
  }

  return `${sanitized.slice(0, maxLength)}\n...[saida truncada: ${sanitized.length - maxLength} caracteres restantes]`
}

function getOutputExcerpt(output: string, stderr: string, secrets: string[]) {
  const combined = [output, stderr].filter(Boolean).join('\n')
  const sanitized = sanitizeSshLogText(combined, secrets)
  const maxLength = 1800

  return sanitized.length > maxLength
    ? `...[saida anterior omitida]\n${sanitized.slice(-maxLength)}`
    : sanitized
}

function createOltCommandError(message: string, output: string, stderr: string, secrets: string[]) {
  const error = new Error(message) as OltCommandError
  error.outputExcerpt = getOutputExcerpt(output, stderr, secrets)
  return error
}

export function getOltCommandErrorOutput(error: unknown) {
  return error && typeof error === 'object' && 'outputExcerpt' in error
    ? String((error as OltCommandError).outputExcerpt || '')
    : ''
}

function shouldLogVerboseSsh() {
  return process.env.OLT_SSH_VERBOSE_LOGS === 'true'
}

function toUtf8(data: unknown) {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
}

function getRecentOutput(output: string[], fromIndex: number) {
  return output.join('').slice(fromIndex)
}

function includesPasswordPrompt(value: string) {
  return /password\s*[:：]?/i.test(value)
}

function includesMorePrompt(value: string) {
  return /--\s*More\s*--/i.test(value)
}

function getCliErrorLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^%(?:Error|Code)\b/i.test(line)
      || /\b(?:invalid input|unknown command|incomplete command|ambiguous command|command authorization failed|not exist|does not exist|not found)\b/i.test(line))
}

function getUnansweredConfirmationPromptLines(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines
    .filter((line, index) => {
      if (!/\b(?:confirm|continue|are you sure|yes\/no|y\/n)\b/i.test(line)) {
        return false
      }

      if (/:\s*(?:yes|y|no|n)\s*$/i.test(line)) {
        return false
      }

      const nextLine = lines[index + 1] || ''
      return !/^(?:yes|y|no|n)$/i.test(nextLine)
    })
}

function assertSuccessfulCliOutput(
  output: string,
  stderr: string,
  command: string,
  logId: string,
  logSecrets: string[],
  verboseSshLogs: boolean,
) {
  const cliErrors = getCliErrorLines(`${output}\n${stderr}`)
  if (cliErrors.length > 0) {
    console.error(`[OLT SSH ${logId}] erro retornado pela OLT`, verboseSshLogs
      ? { command: formatSshLogText(command, logSecrets), errors: cliErrors.map((line) => formatSshLogText(line, logSecrets)) }
      : { commandChars: command.length, errorCount: cliErrors.length })
    throw createOltCommandError(`OLT rejeitou o comando "${command}": ${cliErrors[0]}`, output, stderr, logSecrets)
  }

  const confirmationPrompts = getUnansweredConfirmationPromptLines(output)
  if (confirmationPrompts.length > 0) {
    console.error(`[OLT SSH ${logId}] comando ficou aguardando confirmacao`, verboseSshLogs
      ? { command: formatSshLogText(command, logSecrets), prompts: confirmationPrompts.map((line) => formatSshLogText(line, logSecrets)) }
      : { commandChars: command.length, promptCount: confirmationPrompts.length })
    throw createOltCommandError(`OLT aguardou confirmação após "${command}": ${confirmationPrompts[0]}`, output, stderr, logSecrets)
  }
}

function isLegacyOnuTelemetryCommand(command: string) {
  return /\bshow\s+pon\s+power\s+onu-(?:rx|tx)\b/i.test(command)
    || /\bshow\s+gpon\s+onu\s+detail-info\b/i.test(command)
}

function assertAllowedOltSshCommands(commands: string[]) {
  const blockedCommand = commands.find(isLegacyOnuTelemetryCommand)
  if (!blockedCommand) {
    return
  }

  throw new Error(
    `Consulta SSH de telemetria de ONU removida (${blockedCommand}). Use o monitoramento SNMP/cache em OnuCurrent.`,
  )
}

function getErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
}

function isDisconnectError(error: unknown) {
  const code = getErrorCode(error)
  const message = error instanceof Error ? error.message : String(error)

  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTCONN'].includes(code)
    || /connection.*(reset|closed|lost|aborted)|socket.*(closed|reset)|read ECONNRESET/i.test(message)
}

async function executeOltCommandsOverSshOnce(
  device: OltDeviceConnection,
  commands: string[],
  options: ExecuteOltSshOptions,
) {
  const { Client } = loadSshClient()
  const client = new Client()
  const output: string[] = []
  const stderr: string[] = []
  const logId = getSshLogId(device)
  const logSecrets = getSshLogSecrets(device)
  const verboseSshLogs = shouldLogVerboseSsh()
  const commandDelayMs = Number(process.env.OLT_SSH_COMMAND_DELAY_MS || 250)
  const readyDelayMs = Number(process.env.OLT_SSH_READY_DELAY_MS || 800)
  const timeoutMs = Number(process.env.OLT_SSH_TIMEOUT_MS || 45000)
  const closeDelayMs = Number(process.env.OLT_SSH_CLOSE_DELAY_MS || 1500)
  const exitCommands = options.exitCommands
    ?? (process.env.OLT_SSH_EXIT_COMMANDS || 'exit,exit')
      .split(',')
      .map((command) => command.trim())
      .filter(Boolean)
  const allowPartialOnDisconnect = options.allowPartialOnDisconnect ?? false
  const stopOnCliError = options.stopOnCliError ?? false

  return new Promise<{ output: string; stderr: string }>((resolve, reject) => {
    let settled = false
    let lastAction = 'iniciando conexao'
    const timeout = setTimeout(() => {
      const error = new Error(`Timeout ao executar comandos SSH na OLT ${device.name}.`)
      console.error(`[OLT SSH ${logId}] timeout`, {
        device: device.name,
        host: device.host || device.ipv4,
        port: device.port,
        timeoutMs,
        lastAction,
      })
      fail(error)
      safeClientEnd('timeout')
    }, timeoutMs)

    const finish = (event: string) => {
      if (settled) return
      const result = { output: output.join(''), stderr: stderr.join('') }
      if (stopOnCliError) {
        try {
          assertSuccessfulCliOutput(result.output, result.stderr, lastAction, logId, logSecrets, verboseSshLogs)
        } catch (error) {
          fail(error)
          return
        }
      }

      settled = true
      clearTimeout(timeout)
      if (verboseSshLogs) {
        console.log(`[OLT SSH ${logId}] conexao finalizada`, {
          event,
          stdoutChars: result.output.length,
          stderrChars: result.stderr.length,
        })
      }
      resolve(result)
    }

    const fail = (error: unknown) => {
      if (settled) return
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      const result = { output: output.join(''), stderr: stderr.join('') }
      if (allowPartialOnDisconnect && isDisconnectError(normalizedError) && result.output.trim()) {
        if (stopOnCliError) {
          try {
            assertSuccessfulCliOutput(result.output, result.stderr, lastAction, logId, logSecrets, verboseSshLogs)
          } catch (cliError) {
            settled = true
            clearTimeout(timeout)
            const cliErrorMessage = cliError instanceof Error ? cliError.message : String(cliError)
            console.error(`[OLT SSH ${logId}] retorno parcial contem erro da OLT`, {
              message: cliErrorMessage,
              stdoutChars: result.output.length,
              stderrChars: result.stderr.length,
              lastAction,
            })
            reject(cliError instanceof Error ? cliError : new Error(cliErrorMessage))
            return
          }
        }

        settled = true
        clearTimeout(timeout)
        console.warn(`[OLT SSH ${logId}] conexao caiu, usando retorno parcial`, {
          message: normalizedError.message,
          stdoutChars: result.output.length,
          stderrChars: result.stderr.length,
          lastAction,
        })
        resolve(result)
        return
      }

      settled = true
      clearTimeout(timeout)
      console.error(`[OLT SSH ${logId}] falha`, {
        message: normalizedError.message,
        code: getErrorCode(normalizedError) || undefined,
        lastAction,
      })
      reject(normalizedError)
    }

    const safeClientEnd = (reason: string) => {
      try {
        client.end()
      } catch (error) {
        console.warn(`[OLT SSH ${logId}] falha ao encerrar cliente SSH`, {
          reason,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const safeStreamWrite = (stream: SshStream, data: string, action: string) => {
      try {
        stream.write(data)
      } catch (error) {
        lastAction = action
        fail(error)
        safeClientEnd(action)
      }
    }

    const safeStreamEnd = (stream: SshStream, reason: string) => {
      try {
        stream.end()
      } catch (error) {
        console.warn(`[OLT SSH ${logId}] falha ao encerrar shell SSH`, {
          reason,
          message: error instanceof Error ? error.message : String(error),
        })
        fail(error)
      }
    }

    const logSend = (label: string, command: string) => {
      lastAction = label
      if (verboseSshLogs) {
        console.log(`[OLT SSH ${logId}] enviando comando`, {
          action: label,
          command: formatSshLogText(command, logSecrets),
        })
      }
    }

    const advancePagination = async (stream: SshStream, label: string, cursor: number) => {
      const maxPages = Number(process.env.OLT_SSH_MAX_MORE_PAGES || 30)
      let pages = 0
      let currentCursor = cursor

      while (includesMorePrompt(getRecentOutput(output, currentCursor)) && pages < maxPages) {
        pages += 1
        lastAction = `${label}: avancando paginacao ${pages}/${maxPages}`
        currentCursor = output.join('').length
        if (verboseSshLogs) {
          console.log(`[OLT SSH ${logId}] avancando paginacao`, {
            action: label,
            page: pages,
            maxPages,
          })
        }
        safeStreamWrite(stream, ' ', lastAction)
        if (settled) return
        await wait(commandDelayMs)
      }

      if (pages >= maxPages && includesMorePrompt(getRecentOutput(output, currentCursor))) {
        console.warn(`[OLT SSH ${logId}] limite de paginacao atingido`, {
          action: label,
          maxPages,
        })
      }
    }

    if (verboseSshLogs) {
      console.log(`[OLT SSH ${logId}] iniciando`, {
        device: device.name,
        host: device.host || device.ipv4,
        port: device.port,
        username: device.username,
        commandCount: commands.length,
        commandDelayMs,
        readyDelayMs,
        closeDelayMs,
        timeoutMs,
        exitCommands,
      })
    }

    client
      .on('ready', () => {
        lastAction = 'abrindo shell'
        if (verboseSshLogs) {
          console.log(`[OLT SSH ${logId}] conexao pronta, abrindo shell`)
        }
        client.shell(async (error, stream) => {
          if (error) {
            safeClientEnd('erro ao abrir shell')
            fail(error)
            return
          }

          if (verboseSshLogs) {
            console.log(`[OLT SSH ${logId}] shell aberto`)
          }

          stream.on('data', (data) => {
            const text = toUtf8(data)
            output.push(text)
            if (verboseSshLogs && text.trim()) {
              console.log(`[OLT SSH ${logId}] stdout`, formatSshLogText(text, logSecrets))
            }
          })
          stream.stderr?.on('data', (data) => {
            const text = toUtf8(data)
            stderr.push(text)
            if (verboseSshLogs && text.trim()) {
              console.error(`[OLT SSH ${logId}] stderr`, formatSshLogText(text, logSecrets))
            }
          })
          stream.on('error', (streamError) => {
            console.error(`[OLT SSH ${logId}] erro no shell SSH`, {
              message: streamError instanceof Error ? streamError.message : String(streamError),
              code: getErrorCode(streamError) || undefined,
              lastAction,
            })
            fail(streamError)
            safeClientEnd('erro no shell SSH')
          })
          stream.stderr?.on('error', (streamError) => {
            console.error(`[OLT SSH ${logId}] erro no stderr SSH`, {
              message: streamError instanceof Error ? streamError.message : String(streamError),
              code: getErrorCode(streamError) || undefined,
              lastAction,
            })
            fail(streamError)
            safeClientEnd('erro no stderr SSH')
          })
          stream.on('close', () => {
            if (verboseSshLogs) {
              console.log(`[OLT SSH ${logId}] shell fechado`)
            }
          })

          try {
            lastAction = `aguardando prompt inicial por ${readyDelayMs}ms`
            if (verboseSshLogs) {
              console.log(`[OLT SSH ${logId}] aguardando prompt inicial`, { readyDelayMs })
            }
            await wait(readyDelayMs)

            if (device.useEnableMode && device.enablePassword) {
              const enableCursor = output.join('').length
              logSend('entrando em modo enable', 'enable')
              safeStreamWrite(stream, 'enable\n', 'entrando em modo enable')
              if (settled) return
              await wait(commandDelayMs)
              const enableOutput = getRecentOutput(output, enableCursor)
              if (includesPasswordPrompt(enableOutput)) {
                lastAction = 'enviando senha enable'
                if (verboseSshLogs) {
                  console.log(`[OLT SSH ${logId}] enviando senha enable`, { command: '[senha ocultada]' })
                }
                safeStreamWrite(stream, `${device.enablePassword}\n`, 'enviando senha enable')
                if (settled) return
                await wait(commandDelayMs)
              } else if (verboseSshLogs) {
                console.log(`[OLT SSH ${logId}] senha enable nao solicitada`)
              }
            } else if (device.useEnableMode && !device.enablePassword) {
              console.warn(`[OLT SSH ${logId}] modo enable habilitado sem senha adicional cadastrada`)
            }

            for (const [index, command] of commands.entries()) {
              const commandCursor = output.join('').length
              logSend(`comando ${index + 1}/${commands.length}`, command)
              safeStreamWrite(stream, `${command}\n`, `comando ${index + 1}/${commands.length}`)
              if (settled) return
              await wait(commandDelayMs)
              if (settled) return
              await advancePagination(stream, `comando ${index + 1}/${commands.length}`, commandCursor)
              if (settled) return
              const cliErrors = getCliErrorLines(getRecentOutput(output, commandCursor))
              if (stopOnCliError && cliErrors.length > 0) {
                safeClientEnd('erro retornado pela OLT')
                fail(createOltCommandError(
                  `OLT rejeitou o comando "${command}": ${cliErrors[0]}`,
                  getRecentOutput(output, commandCursor),
                  '',
                  logSecrets,
                ))
                return
              }
            }

            for (const [index, command] of exitCommands.entries()) {
              logSend(`comando de saida ${index + 1}/${exitCommands.length}`, command)
              safeStreamWrite(stream, `${command}\n`, `comando de saida ${index + 1}/${exitCommands.length}`)
              if (settled) return
              await wait(commandDelayMs)
              if (settled) return
            }

            lastAction = `aguardando retorno final por ${closeDelayMs}ms`
            if (verboseSshLogs) {
              console.log(`[OLT SSH ${logId}] aguardando retorno final antes de encerrar`, { closeDelayMs })
            }
            await wait(closeDelayMs)
            if (settled) return
            lastAction = 'forcando encerramento da conexao SSH'
            if (verboseSshLogs) {
              console.log(`[OLT SSH ${logId}] forçando encerramento da conexao SSH`)
            }
            safeStreamEnd(stream, 'fim dos comandos')
            safeClientEnd('fim dos comandos')
          } catch (streamError) {
            safeClientEnd('erro durante comandos')
            fail(streamError)
          }
        })
      })
      .on('error', (error) => {
        fail(error)
      })
      .on('end', () => {
        finish('end')
      })
      .on('close', () => {
        finish('close')
      })
      .connect({
        host: device.host || device.ipv4,
        port: device.port,
        username: device.username,
        password: device.password,
        readyTimeout: timeoutMs,
      })
  })
}

export async function executeOltCommandsOverSsh(
  device: OltDeviceConnection,
  commands: string[],
  options: ExecuteOltSshOptions = {},
) {
  assertAllowedOltSshCommands(commands)

  const retries = Math.max(0, options.retries ?? 0)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? Number(process.env.OLT_SSH_RETRY_DELAY_MS || 1200))

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await executeOltCommandsOverSshOnce(device, commands, options)
    } catch (error) {
      const canRetry = attempt < retries && isDisconnectError(error)
      if (!canRetry) {
        throw error
      }

      console.warn('[OLT SSH] tentativa falhou, repetindo conexao', {
        device: device.name,
        host: device.host || device.ipv4,
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        retries,
        retryDelayMs,
        message: error instanceof Error ? error.message : String(error),
        code: getErrorCode(error) || undefined,
      })
      await wait(retryDelayMs)
    }
  }

  throw new Error(`Falha SSH inesperada ao executar comandos na OLT ${device.name}.`)
}
