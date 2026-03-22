import React from 'react'
import type { AppUpdateState, ReleaseNotesRangeResult } from '@shared/contracts/dto'
import type { UiLanguage } from '@contexts/settings/domain/agentSettings'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'

function getReleaseNotesApi() {
  return window.opencoveApi?.releaseNotes
}

function normalizeVersionTag(version: string): string {
  const trimmed = version.trim()
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

function buildCompareUrl(fromVersion: string, toVersion: string): string {
  const base = 'https://github.com/DeadWaveWave/opencove/compare'
  const fromTag = normalizeVersionTag(fromVersion)
  const toTag = normalizeVersionTag(toVersion)
  return `${base}/${encodeURIComponent(fromTag)}...${encodeURIComponent(toTag)}`
}

function buildChangelogUrl(): string {
  return 'https://github.com/DeadWaveWave/opencove/blob/main/CHANGELOG.md'
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
  notes: ReleaseNotesRangeResult | null
  isLoading: boolean
  error: string | null
  language: UiLanguage
  compareUrl: string | null
  close: () => void
} {
  const [isOpen, setIsOpen] = React.useState(false)
  const [fromVersion, setFromVersion] = React.useState<string | null>(null)
  const [toVersion, setToVersion] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<ReleaseNotesRangeResult | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [compareUrl, setCompareUrl] = React.useState<string | null>(null)

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

    if (seenVersion && seenVersion === currentVersion) {
      return
    }

    if (isOpen) {
      return
    }

    const api = getReleaseNotesApi()
    if (!api) {
      return
    }

    let active = true

    setIsOpen(true)
    setFromVersion(seenVersion)
    setToVersion(currentVersion)
    setNotes(null)
    setError(null)
    setIsLoading(true)

    const request = seenVersion
      ? api.getRange({ fromVersion: seenVersion, toVersion: currentVersion })
      : api.getAutoRange({ toVersion: currentVersion })

    setCompareUrl(seenVersion ? buildCompareUrl(seenVersion, currentVersion) : buildChangelogUrl())

    void request
      .then(result => {
        if (!active) {
          return
        }

        setNotes(result)
        setFromVersion(result.fromVersion !== result.toVersion ? result.fromVersion : null)
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
      })

    return () => {
      active = false
    }
  }, [currentVersion, isOpen, isPersistReady, onChangeSettings, seenVersion, updateStatus])

  const close = React.useCallback(() => {
    const version = toVersion ?? currentVersion
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
