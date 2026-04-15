import { useEffect } from 'react'
import {
  flushScheduledPersistedStateWriteAsync,
  schedulePersistedStateWrite,
  toPersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence'
import { flushScheduledNodeScrollbackWrites } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
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
      schedulePersistedStateWrite(producePersistedState, { delayMs: 0 })
      flushScheduledNodeScrollbackWrites()
      const flushScrollbackMirrors = window.opencoveApi?.pty?.flushScrollbackMirrors
      await Promise.allSettled([
        flushScheduledPersistedStateWriteAsync(),
        typeof flushScrollbackMirrors === 'function' ? flushScrollbackMirrors() : Promise.resolve(),
      ])
    })
  }, [enabled])
}
