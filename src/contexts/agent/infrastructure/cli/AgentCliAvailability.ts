import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProviderId } from '@shared/contracts/dto'
import { resolveAgentCliCommand } from './AgentCommandFactory'

const execFileAsync = promisify(execFile)

const AGENT_PROVIDERS: readonly AgentProviderId[] = [
  'claude-code',
  'codex',
  'opencode',
  'gemini',
  'cursor-agent',
]

async function isCommandAvailable(command: string): Promise<boolean> {
  const probeCommand = process.platform === 'win32' ? 'where.exe' : 'which'

  try {
    await execFileAsync(probeCommand, [command], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function isCursorAgent(command: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], {
      windowsHide: true,
      timeout: 3000,
    })
    const output = `${stdout}${stderr}`.toLowerCase()
    return output.includes('cursor')
  } catch {
    return false
  }
}

export async function listInstalledAgentProviders(): Promise<AgentProviderId[]> {
  const availability = await Promise.all(
    AGENT_PROVIDERS.map(async provider => {
      const command = resolveAgentCliCommand(provider)
      const commandExists = await isCommandAvailable(command)
      if (!commandExists) {
        return { provider, available: false }
      }

      if (provider === 'cursor-agent') {
        return { provider, available: await isCursorAgent(command) }
      }

      return { provider, available: true }
    }),
  )

  return availability.filter(result => result.available).map(result => result.provider)
}
