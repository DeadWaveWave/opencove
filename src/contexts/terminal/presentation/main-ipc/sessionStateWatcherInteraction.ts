import type { AgentProviderId } from '../../../../shared/contracts/dto'

function isJsonlProvider(provider: AgentProviderId): boolean {
  return provider === 'claude-code' || provider === 'codex'
}

function isExplicitSubmitInteraction(data: string | undefined): boolean {
  return data === '\r' || data === '\n' || data === '\r\n'
}

export function shouldBroadcastOptimisticWorkingFromInteraction({
  provider,
  data,
}: {
  provider: AgentProviderId
  data?: string
}): boolean {
  return isJsonlProvider(provider) && isExplicitSubmitInteraction(data)
}
