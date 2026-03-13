import { execFile } from 'node:child_process'
import { extname } from 'node:path'
const WINDOWS_BATCH_EXTENSIONS = new Set(['.bat', '.cmd'])
const WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS = new Set(['.com', '.exe'])

export interface AgentCliInvocation {
  command: string
  args: string[]
}

function normalizeExtension(command: string): string {
  return extname(command).toLowerCase()
}

function isWindowsBatchCommand(command: string): boolean {
  return WINDOWS_BATCH_EXTENSIONS.has(normalizeExtension(command))
}

function isWindowsDirectExecutable(command: string): boolean {
  return WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS.has(normalizeExtension(command))
}

async function resolveWindowsCommandPath(command: string): Promise<string | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('where.exe', [command], { encoding: 'utf8', windowsHide: true }, (error, out) => {
        if (error) {
          reject(error)
          return
        }

        resolve(typeof out === 'string' ? out : '')
      })
    })

    const firstMatch = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.length > 0)

    return firstMatch ?? null
  } catch {
    return null
  }
}

function wrapWindowsBatchCommand(command: string, args: string[]): AgentCliInvocation {
  return {
    command: 'cmd.exe',
    args: ['/d', '/c', command, ...args],
  }
}

export async function resolveAgentCliInvocation(
  invocation: AgentCliInvocation,
): Promise<AgentCliInvocation> {
  const command = invocation.command.trim()
  const args = [...invocation.args]

  if (process.platform !== 'win32' || command.length === 0 || command.toLowerCase() === 'cmd.exe') {
    return { command, args }
  }

  const resolvedCommand = (await resolveWindowsCommandPath(command)) ?? command

  if (isWindowsDirectExecutable(resolvedCommand)) {
    return {
      command: resolvedCommand,
      args,
    }
  }

  if (isWindowsBatchCommand(resolvedCommand)) {
    return wrapWindowsBatchCommand(resolvedCommand, args)
  }

  if (normalizeExtension(resolvedCommand).length === 0) {
    return wrapWindowsBatchCommand(`${resolvedCommand}.cmd`, args)
  }

  return {
    command: resolvedCommand,
    args,
  }
}
