import { useEffect } from 'react'
import {
  flushScheduledPersistedStateWriteAsync,
  schedulePersistedStateWrite,
  toPersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence'
import { flushScheduledScrollbackWrites } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
import { TERMINAL_SCROLLBACK_FLUSH_EVENT } from '@contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useAppStore } from '../store/useAppStore'

function producePersistedState() {
  const state = useAppStore.getState()
  return toPersistedState(state.workspaces, state.activeWorkspaceId, state.agentSettings)
}

export function useAppQuitPersistenceFlush({ enabled }: { enabled: boolean }): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const register = window.opencoveApi?.lifecycle?.onRequestPersistFlush
    if (typeof register !== 'function') {
      return
    }

    return register(async () => {
      window.dispatchEvent(new Event(TERMINAL_SCROLLBACK_FLUSH_EVENT))
      schedulePersistedStateWrite(producePersistedState, { delayMs: 0 })
      flushScheduledScrollbackWrites()
      await Promise.allSettled([flushScheduledPersistedStateWriteAsync()])
    })
  }, [enabled])
}
