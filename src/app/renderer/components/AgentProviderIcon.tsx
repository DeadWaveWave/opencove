import React, { type JSX } from 'react'
import { Bot, Code2, Gem, Sparkles, type LucideIcon } from 'lucide-react'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'

const PROVIDER_ICON_BY_ID: Record<AgentProvider, LucideIcon> = {
  'claude-code': Bot,
  codex: Sparkles,
  opencode: Code2,
  gemini: Gem,
}

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
  const Icon = PROVIDER_ICON_BY_ID[provider]
  const accessibleLabel = AGENT_PROVIDER_LABEL[provider]

  return (
    <span
      className={className ? `agent-provider-icon ${className}` : 'agent-provider-icon'}
      data-agent-provider={provider}
      data-cove-label-color={labelColor ?? undefined}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <Icon className="agent-provider-icon__glyph" aria-hidden="true" />
    </span>
  )
}
