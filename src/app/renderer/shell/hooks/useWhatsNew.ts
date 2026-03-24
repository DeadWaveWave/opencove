import React from 'react'
import type { AppUpdateState, ReleaseNotesCurrentResult } from '@shared/contracts/dto'
import type { UiLanguage } from '@contexts/settings/domain/agentSettings'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'

function getReleaseNotesApi() {
  return window.opencoveApi?.releaseNotes
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown error'
}

export function useWhatsNew({
  isPersistReady,
  updateState,
  settings,
  onChangeSettings,
}: {
  isPersistReady: boolean
  updateState: AppUpdateState | null
  settings: AgentSettings
  onChangeSettings: (action: (prev: AgentSettings) => AgentSettings) => void
}): {
  isOpen: boolean
  fromVersion: string | null
  toVersion: string | null
  notes: ReleaseNotesCurrentResult | null
  isLoading: boolean
  error: string | null
  language: UiLanguage
  compareUrl: string | null
  close: () => void
} {
  const [isOpen, setIsOpen] = React.useState(false)
  const [fromVersion, setFromVersion] = React.useState<string | null>(null)
  const [toVersion, setToVersion] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<ReleaseNotesCurrentResult | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [compareUrl, setCompareUrl] = React.useState<string | null>(null)
  const isDialogOpenRef = React.useRef(false)
  const isRequestInFlightRef = React.useRef(false)

  const language = settings.language
  const seenVersion = settings.releaseNotesSeenVersion
  const currentVersion = updateState?.currentVersion ?? null
  const updateStatus = updateState?.status ?? null

  React.useEffect(() => {
    if (!isPersistReady) {
      return
    }

    if (window.opencoveApi?.meta?.isTest && !window.opencoveApi?.meta?.allowWhatsNewInTests) {
      return
    }

    if (!currentVersion) {
      return
    }

    if (updateStatus === 'unsupported' && !window.opencoveApi?.meta?.allowWhatsNewInTests) {
      return
    }

    if (!seenVersion || seenVersion === currentVersion) {
      return
    }

    if (isDialogOpenRef.current || isRequestInFlightRef.current) {
      return
    }

    const api = getReleaseNotesApi()
    if (!api) {
      return
    }

    let active = true
    isDialogOpenRef.current = true
    isRequestInFlightRef.current = true

    setIsOpen(true)
    setFromVersion(seenVersion)
    setToVersion(currentVersion)
    setNotes(null)
    setError(null)
    setIsLoading(true)
    setCompareUrl(null)

    void api
      .getCurrent({ currentVersion, language })
      .then(result => {
        if (!active) {
          return
        }

        setNotes(result)
        setCompareUrl(result.compareUrl)
      })
      .catch(fetchError => {
        if (!active) {
          return
        }

        setError(getErrorMessage(fetchError))
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }

        isRequestInFlightRef.current = false
      })

    return () => {
      active = false
    }
  }, [currentVersion, isPersistReady, language, seenVersion, updateStatus])

  const close = React.useCallback(() => {
    const version = toVersion ?? currentVersion
    isDialogOpenRef.current = false
    isRequestInFlightRef.current = false
    if (version) {
      onChangeSettings(prev => ({ ...prev, releaseNotesSeenVersion: version }))
    }

    setIsOpen(false)
  }, [currentVersion, onChangeSettings, toVersion])

  return {
    isOpen,
    fromVersion,
    toVersion,
    notes,
    isLoading,
    error,
    language,
    compareUrl,
    close,
  }
}
