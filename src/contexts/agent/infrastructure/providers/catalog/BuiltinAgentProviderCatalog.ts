import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../../../../../shared/contracts/dto'
import type { AgentHookChannel } from '../../../../../shared/runtime/agentHook/agentHookChannel'
import type {
  AgentProviderContribution,
  AgentProviderDescriptor,
} from '../../../application/ports/AgentProviderContribution'
import { ClaudeCodeAgentProviderContribution } from '../claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../codex/CodexAgentProviderContribution'
import { CatalogTerminalCliProvider } from './CatalogTerminalCliProvider'

export interface BuiltinAgentProviderCatalogOptions {
  readonly channels?: Partial<Record<AgentProviderId, AgentHookChannel>>
  readonly runtimeExecutable?: string
  readonly runtimePlatform?: NodeJS.Platform
}

const genericDescriptors = [
  descriptor('opencode', 'OpenCode', 'opencode', 'https://opencode.ai/docs/'),
  descriptor('gemini', 'Gemini CLI', 'gemini', 'https://github.com/google-gemini/gemini-cli', {
    arguments: ['--yolo'],
  }),
] as const satisfies readonly AgentProviderDescriptor[]

export function createBuiltinAgentProviderContributions(
  options: BuiltinAgentProviderCatalogOptions = {},
): readonly AgentProviderContribution[] {
  const formal = new Map<AgentProviderId, AgentProviderContribution>([
    [
      'claude-code',
      new ClaudeCodeAgentProviderContribution({
        channel: options.channels?.['claude-code'],
        runtimeExecutable: options.runtimeExecutable,
      }),
    ],
    [
      'codex',
      new CodexAgentProviderContribution({
        channel: options.channels?.codex,
        runtimeExecutable: options.runtimeExecutable,
        runtimePlatform: options.runtimePlatform,
      }),
    ],
  ])
  const generic = new Map<AgentProviderId, AgentProviderContribution>(
    genericDescriptors.map(entry => [entry.id, new CatalogTerminalCliProvider(entry)]),
  )
  return resolveAgentProviderCatalog(AGENT_PROVIDER_IDS, formal, generic)
}

export function resolveAgentProviderCatalog(
  providerIds: readonly AgentProviderId[],
  formal: ReadonlyMap<AgentProviderId, AgentProviderContribution>,
  generic: ReadonlyMap<AgentProviderId, AgentProviderContribution>,
): readonly AgentProviderContribution[] {
  return providerIds.map(providerId => {
    const contribution = formal.get(providerId) ?? generic.get(providerId)
    if (!contribution) {
      throw new Error(`Missing built-in Agent Provider: ${providerId}`)
    }
    return contribution
  })
}

function descriptor(
  id: AgentProviderId,
  displayName: string,
  executable: string,
  documentationUrl: string,
  permission?: AgentProviderDescriptor['launch']['permission'],
): AgentProviderDescriptor {
  return {
    displayName,
    documentationUrl,
    id,
    launch: {
      defaultArguments: [],
      defaultEnvironment: {},
      executable,
      ...(permission ? { permission } : {}),
    },
  }
}
