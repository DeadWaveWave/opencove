import type { Node } from '@xyflow/react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings.providerMeta'
import type { TerminalNodeData } from '../types'

export function providerTitlePrefix(provider: AgentProvider): string {
  if (provider === 'claude-code') {
    return 'claude'
  }

  if (provider === 'opencode') {
    return 'opencode'
  }

  if (provider === 'gemini') {
    return 'gemini'
  }

  if (provider === 'pi' || provider === 'kimi') {
    return provider
  }

  return 'codex'
}

export function buildAgentNodeTitle(provider: AgentProvider, label: string | null): string {
  const normalizedLabel = label?.trim() ?? ''
  if (normalizedLabel.length === 0) {
    return providerTitlePrefix(provider)
  }

  return `${providerTitlePrefix(provider)} · ${normalizedLabel}`
}

export function stripAgentProviderPrefix(
  provider: AgentProvider,
  title: string | null | undefined,
): string {
  let label = title?.trim() ?? ''
  const prefixes = [providerTitlePrefix(provider), provider, AGENT_PROVIDER_LABEL[provider]].map(
    name => `${name.toLowerCase()} · `,
  )
  // Older rename paths could add a second copy. Only strip leading decorations
  // for this provider; another provider or ordinary user text ends the scan.
  for (;;) {
    const prefix = prefixes.find(candidate => label.toLowerCase().startsWith(candidate))
    if (!prefix) {
      return label
    }
    label = label.slice(prefix.length).trim()
  }
}

export function resolveAgentDisplayTitle({
  provider,
  linkedTaskTitle,
  fallbackTitle,
  preferFallbackTitle = false,
}: {
  provider: AgentProvider
  linkedTaskTitle: string | null
  fallbackTitle: string | null
  preferFallbackTitle?: boolean
}): string {
  const normalizedFallbackTitle = fallbackTitle?.trim() ?? ''
  if (preferFallbackTitle) {
    return normalizedFallbackTitle.length > 0
      ? normalizedFallbackTitle
      : providerTitlePrefix(provider)
  }

  const normalizedLinkedTaskTitle = linkedTaskTitle?.trim() ?? ''
  if (normalizedLinkedTaskTitle.length > 0) {
    return buildAgentNodeTitle(provider, normalizedLinkedTaskTitle)
  }

  if (normalizedFallbackTitle.length > 0) {
    return normalizedFallbackTitle
  }

  return providerTitlePrefix(provider)
}

export function resolveAgentDisplayLabel({
  provider,
  linkedTaskTitle,
  fallbackTitle,
  preferFallbackTitle = false,
}: {
  provider: AgentProvider
  linkedTaskTitle: string | null
  fallbackTitle: string | null
  preferFallbackTitle?: boolean
}): string {
  const normalizedFallbackLabel = stripAgentProviderPrefix(provider, fallbackTitle)
  if (preferFallbackTitle) {
    return normalizedFallbackLabel.length > 0
      ? normalizedFallbackLabel
      : providerTitlePrefix(provider)
  }

  const normalizedLinkedTaskTitle = linkedTaskTitle?.trim() ?? ''
  if (normalizedLinkedTaskTitle.length > 0) {
    return normalizedLinkedTaskTitle
  }

  if (normalizedFallbackLabel.length > 0) {
    return normalizedFallbackLabel
  }

  return providerTitlePrefix(provider)
}

export function findLinkedTaskTitleForAgent(
  nodes: readonly Node<TerminalNodeData>[],
  agentNodeId: string,
  taskId: string | null,
): string | null {
  const linkedTaskNode =
    (taskId
      ? (nodes.find(
          candidate =>
            candidate.id === taskId && candidate.data.kind === 'task' && candidate.data.task,
        ) ?? null)
      : null) ??
    nodes.find(
      candidate =>
        candidate.data.kind === 'task' && candidate.data.task?.linkedAgentNodeId === agentNodeId,
    ) ??
    null

  return linkedTaskNode && linkedTaskNode.data.kind === 'task' ? linkedTaskNode.data.title : null
}
