import { useCallback, useEffect, useRef } from 'react'
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
import { flushScheduledNodeScrollbackWrites } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'

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

  const requestPersistFlush = useCallback(() => {
    persistFlushRequestedRef.current = true
  }, [])

  const handlePersistWriteResult = useCallback(
    (result: PersistWriteResult) => {
      setPersistNotice(previous => {
        if (result.ok) {
          if (result.level === 'full') {
            return previous?.kind === 'recovery' ? previous : null
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

        const message =
          result.reason === 'unavailable'
            ? t('persistence.unavailable')
            : result.reason === 'quota' || result.reason === 'payload_too_large'
              ? t('persistence.limitExceeded')
              : result.reason === 'io'
                ? t('persistence.ioFailed', { message: result.message })
                : t('persistence.failed', { message: result.message })

        const next: PersistNotice = { tone: 'error', message, kind: 'write' }
        return previous?.tone === next.tone &&
          previous.message === next.message &&
          previous.kind === next.kind
          ? previous
          : next
      })
    },
    [setPersistNotice, t],
  )

  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest) {
      return
    }

    const handleBeforeUnload = () => {
      flushScheduledNodeScrollbackWrites()
      flushScheduledPersistedStateWrite()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flushScheduledNodeScrollbackWrites()
      flushScheduledPersistedStateWrite()
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

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
    flushScheduledNodeScrollbackWrites()
    flushScheduledPersistedStateWrite()
  }, [handlePersistWriteResult, producePersistedState])

  return { persistNotice, requestPersistFlush, flushPersistNow }
}
