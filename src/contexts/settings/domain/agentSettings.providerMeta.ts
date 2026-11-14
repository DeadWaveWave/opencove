import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentProviderCapabilities,
} from '../../../shared/contracts/agentProviderDescriptors'
import type { AgentProvider } from './agentSettings'

// Derived from the shared provider descriptors; the descriptor table is the single source of truth.
export const AGENT_PROVIDER_LABEL: Readonly<Record<AgentProvider, string>> = Object.fromEntries(
  Object.entries(AGENT_PROVIDER_DESCRIPTORS).map(([provider, { label }]) => [provider, label]),
) as Readonly<Record<AgentProvider, string>>

export const AGENT_PROVIDER_CAPABILITIES: Readonly<
  Record<AgentProvider, AgentProviderCapabilities>
> = Object.fromEntries(
  Object.entries(AGENT_PROVIDER_DESCRIPTORS).map(([provider, { capabilities }]) => [
    provider,
    capabilities,
  ]),
) as Readonly<Record<AgentProvider, AgentProviderCapabilities>>
