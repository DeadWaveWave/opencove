import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalProfile } from '@shared/contracts/dto'
import { createLatestOnlyRequestStore } from '../utils/latestOnly'
import { toErrorMessage } from '../utils/format'

interface TerminalProfilesState {
  profiles: TerminalProfile[]
  defaultProfileId: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

function createInitialTerminalProfilesState(): TerminalProfilesState {
  return {
    profiles: [],
    defaultProfileId: null,
    fetchedAt: null,
    isLoading: false,
    error: null,
  }
}

let cachedTerminalProfilesState = createInitialTerminalProfilesState()

export function useTerminalProfiles(): {
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  refreshTerminalProfiles: () => Promise<void>
} {
  const [state, setState] = useState<TerminalProfilesState>(() => cachedTerminalProfilesState)
  const requestStoreRef = useRef(createLatestOnlyRequestStore<'terminal-profiles'>())

  const refreshTerminalProfiles = useCallback(async (): Promise<void> => {
    const listProfiles = window.opencoveApi.pty.listProfiles
    const requestToken = requestStoreRef.current.start('terminal-profiles')

    if (typeof listProfiles !== 'function') {
      const nextState = {
        profiles: [],
        defaultProfileId: null,
        fetchedAt: new Date().toISOString(),
        isLoading: false,
        error: null,
      }
      cachedTerminalProfilesState = nextState
      setState(nextState)
      return
    }

    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
    }))

    try {
      const result = await listProfiles()

      if (!requestStoreRef.current.isLatest('terminal-profiles', requestToken)) {
        return
      }

      const nextState = {
        profiles: result.profiles,
        defaultProfileId: result.defaultProfileId,
        fetchedAt: new Date().toISOString(),
        isLoading: false,
        error: null,
      }
      cachedTerminalProfilesState = nextState
      setState(nextState)
    } catch (error) {
      if (!requestStoreRef.current.isLatest('terminal-profiles', requestToken)) {
        return
      }

      setState(prev => {
        const nextState = {
          ...prev,
          fetchedAt: new Date().toISOString(),
          isLoading: false,
          error: toErrorMessage(error),
        }
        cachedTerminalProfilesState = nextState
        return nextState
      })
    }
  }, [])

  useEffect(() => {
    if (state.fetchedAt !== null || state.isLoading) {
      return
    }

    void refreshTerminalProfiles()
  }, [refreshTerminalProfiles, state.fetchedAt, state.isLoading])

  return {
    terminalProfiles: state.profiles,
    detectedDefaultTerminalProfileId: state.defaultProfileId,
    refreshTerminalProfiles,
  }
}
