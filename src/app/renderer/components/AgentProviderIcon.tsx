import type { JSX } from 'react'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'
import kimiLogo from '../assets/agent-providers/kimi.png'
import { AgentProviderMark, hasAgentProviderMark } from './AgentProviderMark'

interface AgentProviderIconProps {
  provider: AgentProvider
  labelColor?: LabelColor | null
  className?: string
}

export function AgentProviderIcon({
  provider,
  labelColor = null,
  className,
}: AgentProviderIconProps): JSX.Element {
  const accessibleLabel = AGENT_PROVIDER_LABEL[provider]

  return (
    <span
      className={className ? `agent-provider-icon ${className}` : 'agent-provider-icon'}
      data-cove-part="icon"
      data-cove-kind="agent"
      data-agent-provider={provider}
      data-cove-label-color={labelColor ?? undefined}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <ProviderGlyph provider={provider} />
    </span>
  )
}

function ProviderGlyph({ provider }: { provider: AgentProvider }): JSX.Element {
  if (provider === 'kimi') {
    // Original asset: https://github.com/MoonshotAI/kimi-cli/blob/main/web/public/logo.png
    return (
      <img
        className="agent-provider-icon__image"
        src={kimiLogo}
        width={16}
        height={16}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    )
  }
  if (hasAgentProviderMark(provider)) {
    return <AgentProviderMark provider={provider} className="agent-provider-icon__svg" />
  }
  return (
    <span className="agent-provider-icon__monogram" aria-hidden="true">
      ?
    </span>
  )
}
