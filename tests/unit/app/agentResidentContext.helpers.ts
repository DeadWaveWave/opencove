import {
  inMemoryClaudeHookChannel,
  inMemoryCodexHookChannel,
} from '../../support/inMemoryClaudeHookChannel'

export async function residentChannel(provider: 'claude' | 'codex', enabled = async () => true) {
  const { channel, postReply } = (
    provider === 'claude' ? inMemoryClaudeHookChannel : inMemoryCodexHookChannel
  )()
  channel.setResidentContextEnabled!(enabled)
  const reserve = async (residentContext: 'canvas' | 'none' = 'canvas') =>
    await channel.reserveSpawn({ residentContext })
  const post = async (reservation: Awaited<ReturnType<typeof reserve>>, event = 'SessionStart') =>
    await postReply(reservation.env![`OPENCOVE_${provider.toUpperCase()}_HOOK_TOKEN`]!, event)
  return { channel, reserve, post }
}
