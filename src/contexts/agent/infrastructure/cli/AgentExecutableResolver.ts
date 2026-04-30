import type {
  AgentProviderAvailability,
  AgentProviderAvailabilityStatus,
  AgentProviderId,
} from '@shared/contracts/dto'
import { buildAdditionalPathSegments } from '../../../../platform/os/CliEnvironment'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import {
  locateExecutable,
  type ExecutableLocationResult,
} from '../../../../platform/process/ExecutableLocator'
import { resolveAgentCliInvocation, type AgentCliInvocation } from './AgentCliInvocation'
import { resolveAgentCliCommand } from './AgentCommandFactory'

export interface ResolveAgentExecutableInput {
  provider: AgentProviderId
  overridePath?: string | null
}

export interface ResolvedAgentExecutable extends ExecutableLocationResult {
  provider: AgentProviderId
}

const executableResolutionCache = new Map<string, Promise<ResolvedAgentExecutable>>()

function toCacheKey(input: ResolveAgentExecutableInput): string {
  return `${input.provider}\u0000${input.overridePath?.trim() ?? ''}`
}

function cloneResolvedExecutable(resolved: ResolvedAgentExecutable): ResolvedAgentExecutable {
  return {
    ...resolved,
    diagnostics: [...resolved.diagnostics],
  }
}

function toAvailabilityStatus(resolved: ResolvedAgentExecutable): AgentProviderAvailabilityStatus {
  if (resolved.status === 'resolved') {
    return 'available'
  }

  return resolved.status === 'invalid_override' ? 'misconfigured' : 'unavailable'
}

async function resolveAgentExecutableUncached(
  input: ResolveAgentExecutableInput,
): Promise<ResolvedAgentExecutable> {
  const command = resolveAgentCliCommand(input.provider)
  const fallbackDirectories = buildAdditionalPathSegments(process.platform, resolveHomeDirectory())
  const resolved = await locateExecutable({
    toolId: input.provider,
    command,
    overridePath: input.overridePath ?? null,
    fallbackDirectories,
  })

  return {
    ...resolved,
    provider: input.provider,
  }
}

export async function resolveAgentExecutable(
  input: ResolveAgentExecutableInput,
): Promise<ResolvedAgentExecutable> {
  const cacheKey = toCacheKey(input)
  let cached = executableResolutionCache.get(cacheKey)

  if (!cached) {
    cached = resolveAgentExecutableUncached(input)
    executableResolutionCache.set(cacheKey, cached)
  }

  return cloneResolvedExecutable(await cached)
}

export async function resolveAgentExecutableInvocation(options: {
  provider: AgentProviderId
  args: string[]
  overridePath?: string | null
}): Promise<{ executable: ResolvedAgentExecutable; invocation: AgentCliInvocation }> {
  const executable = await resolveAgentExecutable({
    provider: options.provider,
    overridePath: options.overridePath ?? null,
  })

  if (!executable.executablePath) {
    const diagnostics = executable.diagnostics.join(' ')
    throw new Error(
      diagnostics.length > 0
        ? diagnostics
        : `Unable to resolve executable for ${options.provider}.`,
    )
  }

  return {
    executable,
    invocation: await resolveAgentCliInvocation({
      command: executable.executablePath,
      args: [...options.args],
    }),
  }
}

export async function resolveAgentProviderAvailability(
  input: ResolveAgentExecutableInput,
): Promise<AgentProviderAvailability> {
  const resolved = await resolveAgentExecutable(input)

  return {
    provider: input.provider,
    command: resolved.command,
    status: toAvailabilityStatus(resolved),
    executablePath: resolved.executablePath,
    source: resolved.source,
    diagnostics: [...resolved.diagnostics],
  }
}

export function disposeAgentExecutableResolver(): void {
  executableResolutionCache.clear()
}
