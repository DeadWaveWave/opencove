import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProviderId } from '@shared/contracts/dto'
import { resolveAgentCliCommand } from './AgentCommandFactory'

const execFileAsync = promisify(execFile)

const AGENT_PROVIDERS: readonly AgentProviderId[] = ['claude-code', 'codex', 'opencode', 'gemini']

async function isCommandAvailable(command: string): Promise<boolean> {
  const probeCommand = process.platform === 'win32' ? 'where.exe' : 'which'

  try {
    await execFileAsync(probeCommand, [command], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export async function listInstalledAgentProviders(): Promise<AgentProviderId[]> {
  const availability = await Promise.all(
    AGENT_PROVIDERS.map(async provider => ({
      provider,
      available: await isCommandAvailable(resolveAgentCliCommand(provider)),
    })),
  )

  return availability.filter(result => result.available).map(result => result.provider)
}
