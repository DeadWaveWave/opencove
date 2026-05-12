import { createServer } from 'node:net'
import { resolveAgentLaunchSpawn } from '../../../../contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver'
import { resolveLocalWorkerEndpointRef } from '../../../../contexts/project/application/resolveLocalWorkerEndpointRef'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import {
  normalizeAgentSettings,
  type AgentProvider,
} from '../../../../contexts/settings/domain/agentSettings'
import type { ExecutionContextDto, WorkerEndpointKindDto } from '../../../../shared/contracts/dto'

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

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

export function resolveExecutionContextDto(
  workingDirectory: string,
  options: {
    projectId?: string | null
    spaceId?: string | null
    mountId?: string | null
    targetId?: string | null
    endpointId?: string | null
    endpointKind?: WorkerEndpointKindDto | null
    targetRootPath?: string | null
    targetRootUri?: string | null
    scopeRootPath?: string | null
    scopeRootUri?: string | null
  } = {},
): ExecutionContextDto {
  const endpoint = resolveLocalWorkerEndpointRef()
  const endpointId = normalizeOptionalString(options.endpointId) ?? endpoint.endpointId
  const endpointKind = options.endpointKind ?? endpoint.kind
  const targetRootPath = normalizeOptionalString(options.targetRootPath) ?? workingDirectory
  const targetRootUri = normalizeOptionalString(options.targetRootUri) ?? toFileUri(targetRootPath)
  const scopeRootPath = normalizeOptionalString(options.scopeRootPath) ?? workingDirectory
  const scopeRootUri = normalizeOptionalString(options.scopeRootUri) ?? toFileUri(scopeRootPath)

  return {
    projectId: normalizeOptionalString(options.projectId) ?? null,
    spaceId: normalizeOptionalString(options.spaceId) ?? null,
    mountId: normalizeOptionalString(options.mountId) ?? null,
    targetId: normalizeOptionalString(options.targetId) ?? null,
    endpoint: {
      endpointId,
      kind: endpointKind satisfies WorkerEndpointKindDto,
    },
    target: {
      scheme: 'file',
      rootPath: targetRootPath,
      rootUri: targetRootUri,
    },
    scope: {
      rootPath: scopeRootPath,
      rootUri: scopeRootUri,
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
  provider?: AgentProvider | null
  executablePathOverride?: string | null
  env?: NodeJS.ProcessEnv
}

interface ResolvedSessionLaunchSpawn {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  profileId: string | null
  runtimeKind: 'windows' | 'wsl' | 'posix'
}

export async function resolveSessionLaunchSpawn(
  input: ResolveSessionLaunchSpawnInput,
): Promise<ResolvedSessionLaunchSpawn> {
  const resolved = await resolveAgentLaunchSpawn({
    cwd: input.workingDirectory,
    profileId: input.defaultTerminalProfileId,
    command: input.command,
    args: input.args,
    executablePathOverride: input.executablePathOverride,
    env: input.env,
  })

  return resolved
}
