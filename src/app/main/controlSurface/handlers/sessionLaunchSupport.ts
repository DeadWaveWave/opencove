import { createServer } from 'node:net'
import process from 'node:process'
import { resolveAgentCliInvocation } from '../../../../contexts/agent/infrastructure/cli/AgentCliInvocation'
import { resolveLocalWorkerEndpointRef } from '../../../../contexts/project/application/resolveLocalWorkerEndpointRef'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { TerminalProfileResolver } from '../../../../platform/terminal/TerminalProfileResolver'
import {
  normalizeAgentSettings,
  type AgentProvider,
} from '../../../../contexts/settings/domain/agentSettings'
import type { ExecutionContextDto } from '../../../../shared/contracts/dto'

const terminalProfileResolver = new TerminalProfileResolver()

export async function reserveLoopbackPort(hostname: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()

    server.once('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve local loopback port')))
        return
      }

      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

export function resolveExecutionContextDto(workingDirectory: string): ExecutionContextDto {
  const endpoint = resolveLocalWorkerEndpointRef()
  const rootUri = toFileUri(workingDirectory)

  return {
    endpoint: {
      id: endpoint.id,
      kind: endpoint.kind,
    },
    target: {
      scheme: 'file',
      rootPath: workingDirectory,
      rootUri,
    },
    scope: {
      rootPath: workingDirectory,
      rootUri,
    },
    workingDirectory,
  }
}

export function resolveProviderFromSettings(
  requestedProvider: string | null,
  settings: ReturnType<typeof normalizeAgentSettings>,
): AgentProvider {
  if (
    requestedProvider === 'claude-code' ||
    requestedProvider === 'codex' ||
    requestedProvider === 'opencode' ||
    requestedProvider === 'gemini'
  ) {
    return requestedProvider
  }

  return settings.defaultProvider
}

interface ResolveSessionLaunchSpawnInput {
  workingDirectory: string
  defaultTerminalProfileId?: string | null
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

interface ResolvedSessionLaunchSpawn {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export async function resolveSessionLaunchSpawn(
  input: ResolveSessionLaunchSpawnInput,
): Promise<ResolvedSessionLaunchSpawn> {
  if (input.defaultTerminalProfileId && input.defaultTerminalProfileId.trim().length > 0) {
    return await terminalProfileResolver.resolveCommandSpawn({
      cwd: input.workingDirectory,
      profileId: input.defaultTerminalProfileId,
      command: input.command,
      args: input.args,
      ...(input.env ? { env: input.env } : {}),
    })
  }

  const resolvedInvocation = await resolveAgentCliInvocation({
    command: input.command,
    args: input.args,
  })

  return {
    command: resolvedInvocation.command,
    args: resolvedInvocation.args,
    cwd: input.workingDirectory,
    env: input.env ? { ...process.env, ...input.env } : undefined,
  }
}
