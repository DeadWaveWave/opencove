import { registerWorkspaceDocumentPersistFlush } from '@contexts/workspace/presentation/renderer'
import { currentManagedClaudeCompatibilityNotice } from '@contexts/workspace/presentation/renderer/utils/managedClaudeCompatibilityNotice'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  PersistedAppState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  flushScheduledPersistedStateWrite,
  type PersistWriteResult,
  schedulePersistedStateWrite,
} from '@contexts/workspace/presentation/renderer/utils/persistence'
import type { PersistNotice } from '../types'
import { useAppStore } from '../store/useAppStore'
import { flushScheduledScrollbackWrites } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
import { TERMINAL_SCROLLBACK_FLUSH_EVENT } from '@contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { toErrorMessage } from '../utils/format'
import { createPersistenceDiagnostics, persistenceFailureNoticeKey } from './persistenceDiagnostics'
import { logRuntimeDiagnostics } from '@app/renderer/debug/runtimeDiagnostics'

function flushTerminalScrollback(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(TERMINAL_SCROLLBACK_FLUSH_EVENT))
}

export function usePersistedAppState({
  workspaces,
  activeWorkspaceId,
  agentSettings,
  isHydrated,
  producePersistedState,
}: {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  agentSettings: AgentSettings
  isHydrated: boolean
  producePersistedState: () => PersistedAppState
}): {
  persistNotice: PersistNotice | null
  requestPersistFlush: () => void
  flushPersistNow: () => void
} {
  const { t } = useTranslation()
  const persistNotice = useAppStore(state => state.persistNotice)
  const setPersistNotice = useAppStore(state => state.setPersistNotice)
  const persistFlushRequestedRef = useRef(false)
  const initialHydrationWriteSkippedRef = useRef(false)
  const diagnosticsRef = useRef<ReturnType<typeof createPersistenceDiagnostics> | null>(null)
  diagnosticsRef.current ??= createPersistenceDiagnostics(logRuntimeDiagnostics)

  const handlePersistWriteResult = useCallback(
    (result: PersistWriteResult) => {
      const noticeKey = result.ok ? null : persistenceFailureNoticeKey(result)
      diagnosticsRef.current?.(result, noticeKey, Date.now())
      setPersistNotice(previous => {
        if (previous?.kind === 'connection') {
          return previous
        }
        if (result.ok) {
          if (result.level === 'full') {
            return previous?.kind === 'recovery' ||
              /* @compat managed-claude-worker-support */ previous?.kind === 'compatibility'
              ? previous
              : /* @compat managed-claude-worker-support */ currentManagedClaudeCompatibilityNotice()
          }

          const message =
            result.level === 'no_scrollback'
              ? t('persistence.savedWithoutScrollback')
              : t('persistence.savedSettingsOnly')

          const next: PersistNotice = { tone: 'warning', message, kind: 'write' }
          return previous?.tone === next.tone &&
            previous.message === next.message &&
            previous.kind === next.kind
            ? previous
            : next
        }

        const identityConflict = result.error.code === 'persistence.owned_node_identity_conflict'
        const message = t(noticeKey!, { message: toErrorMessage(result.error) })

        const next: PersistNotice = {
          tone: identityConflict ? 'warning' : 'error',
          message,
          kind: 'write',
        }
        return previous?.tone === next.tone &&
          previous.message === next.message &&
          previous.kind === next.kind
          ? previous
          : next
      })
    },
    [setPersistNotice, t],
  )

  const requestPersistFlush = useCallback(() => {
    persistFlushRequestedRef.current = true

    // Most callers also update the app-state object, which naturally reruns
    // the persistence effect below. Canvas disclosure state lives in a
    // presentation store, though, so collapsing a node may not change that
    // object at all. Schedule a write here as well so the preference is
    // durable even when it is the only change before the app closes.
    if (isHydrated) {
      schedulePersistedStateWrite(producePersistedState, {
        onResult: handlePersistWriteResult,
      })
    }
  }, [handlePersistWriteResult, isHydrated, producePersistedState])

  // One registration for the shell's lifetime, calling the latest `requestPersistFlush`. Its
  // identity changes with hydration and the language; re-registering on each change left the
  // child effects of that commit with nothing to reach, because React runs every passive cleanup
  // of a commit before any passive setup. A layout effect registers before any passive effect of
  // the first commit runs.
  const requestPersistFlushRef = useRef(requestPersistFlush)
  useLayoutEffect(() => {
    requestPersistFlushRef.current = requestPersistFlush
  }, [requestPersistFlush])
  useLayoutEffect(
    () => registerWorkspaceDocumentPersistFlush(() => requestPersistFlushRef.current()),
    [],
  )

  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest) {
      return
    }

    const handleBeforeUnload = () => {
      flushTerminalScrollback()
      flushScheduledScrollbackWrites()
      flushScheduledPersistedStateWrite()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flushTerminalScrollback()
      flushScheduledScrollbackWrites()
      flushScheduledPersistedStateWrite()
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      initialHydrationWriteSkippedRef.current = false
      return
    }

    if (!initialHydrationWriteSkippedRef.current && !persistFlushRequestedRef.current) {
      initialHydrationWriteSkippedRef.current = true
      return
    }

    initialHydrationWriteSkippedRef.current = true
    schedulePersistedStateWrite(producePersistedState, { onResult: handlePersistWriteResult })

    if (persistFlushRequestedRef.current) {
      persistFlushRequestedRef.current = false
      flushScheduledPersistedStateWrite()
    }
  }, [
    activeWorkspaceId,
    agentSettings,
    handlePersistWriteResult,
    isHydrated,
    producePersistedState,
    workspaces,
  ])

  const flushPersistNow = useCallback(() => {
    schedulePersistedStateWrite(producePersistedState, {
      delayMs: 0,
      onResult: handlePersistWriteResult,
    })
    flushTerminalScrollback()
    flushScheduledScrollbackWrites()
    flushScheduledPersistedStateWrite()
  }, [handlePersistWriteResult, producePersistedState])

  return { persistNotice, requestPersistFlush, flushPersistNow }
}
