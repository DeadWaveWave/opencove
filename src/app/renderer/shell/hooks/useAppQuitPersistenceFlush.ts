import { drainPersistedStateAtQuit } from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import { useEffect } from 'react'
import { translate } from '@app/renderer/i18n'
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
      const captured = producePersistedState()
      const deadline = Date.now() + 1500
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const flushed = await Promise.race([
          flushScheduledPersistedStateWriteAsync().then(() => true),
          new Promise<boolean>(resolve => {
            timeout = setTimeout(() => resolve(false), 1500)
          }),
        ])
        if (
          !flushed ||
          !(await drainPersistedStateAtQuit(captured, Math.max(1, deadline - Date.now())))
        ) {
          throw new Error(translate('persistence.quitSaveFailed'))
        }
      } catch (error) {
        useAppStore.getState().setPersistNotice({
          tone: 'error',
          kind: 'write',
          message: translate('persistence.quitSaveFailed'),
        })
        throw error
      } finally {
        if (timeout) {
          clearTimeout(timeout)
        }
      }
    })
  }, [enabled])
}
