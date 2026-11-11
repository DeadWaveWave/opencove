import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { usePersistedAppState } from '@app/renderer/shell/hooks/usePersistedAppState'
import { drainPersistedStateAtQuit } from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import type { Client } from './client'

/** Mount the real autosave consumer, including the hydration skip and settings dependency. */
export function autosave(client: Client) {
  return renderHook(() => {
    const { workspaces, activeWorkspaceId, agentSettings } = useAppStore()
    usePersistedAppState({
      workspaces,
      activeWorkspaceId,
      agentSettings,
      isHydrated: true,
      producePersistedState: client.state,
    })
  })
}
export async function quit(
  client: Client,
  input: Parameters<typeof drainPersistedStateAtQuit>[0],
  mode: 'quit' | 'quit-timeout' | 'quit-failure',
) {
  if (mode === 'quit-failure') {
    client.server.failRead = true
  }
  // The commit, not just its response, happens after the deadline. No later quiet flush can repair it.
  if (mode === 'quit-timeout') {
    client.server.delayCommitMs = 100
  }
  const started = Date.now()
  const work = drainPersistedStateAtQuit(input, 50)
  await vi.advanceTimersByTimeAsync(mode === 'quit-timeout' ? 50 : 0)
  const success = await work
  client.server.model.checkQuit(success)
  if (mode === 'quit-timeout' && Date.now() - started !== 50) {
    throw new Error('I8: timeout did not bound quit at its deadline')
  }
  if (mode !== 'quit' && success) {
    throw new Error('I8: failed/timed-out quit reported success')
  }
  if (mode === 'quit-timeout') {
    // Quit was cancelled. Let submitted I/O settle before continuing; keep the actual failure result.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    client.server.delayCommitMs = 0
  }
  client.server.failRead = false
  return success
}
