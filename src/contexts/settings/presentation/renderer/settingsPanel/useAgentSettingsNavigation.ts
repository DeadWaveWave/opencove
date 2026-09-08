import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  isSelectableAgentProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'

/** Provider navigation is transient UI state; settings and installation keep their existing owners. */
export function useAgentSettingsNavigation(
  requestedProvider?: AgentProvider | null,
  requestKey?: number,
) {
  const viewRef = useRef<HTMLDivElement>(null)
  const [activeProvider, setActiveProvider] = useState<AgentProvider | null>(null)
  const lastRequestRef = useRef<{ provider: AgentProvider | null; key?: number } | null>(null)
  const returnPointRef = useRef<{ provider: AgentProvider; scrollTop: number } | null>(null)
  const restoreListRef = useRef(false)

  const openProvider = useCallback(
    (provider: AgentProvider) => {
      if (!isSelectableAgentProvider(provider)) {
        return
      }
      if (activeProvider === null) {
        const content = viewRef.current?.closest<HTMLElement>('.settings-panel__content')
        returnPointRef.current = { provider, scrollTop: content?.scrollTop ?? 0 }
      }
      restoreListRef.current = false
      setActiveProvider(provider)
    },
    [activeProvider],
  )

  const backToList = useCallback(() => {
    restoreListRef.current = true
    setActiveProvider(null)
  }, [])

  useLayoutEffect(() => {
    if (requestedProvider === undefined) {
      return
    }
    const previous = lastRequestRef.current
    if (previous?.provider === requestedProvider && previous.key === requestKey) {
      return
    }
    lastRequestRef.current = { provider: requestedProvider, key: requestKey }
    if (requestedProvider === null) {
      backToList()
    } else {
      openProvider(requestedProvider)
    }
  }, [requestedProvider, requestKey, openProvider, backToList])

  useLayoutEffect(() => {
    const view = viewRef.current
    const content = view?.closest<HTMLElement>('.settings-panel__content')
    if (activeProvider !== null) {
      if (content) {
        content.scrollTop = 0
      }
      view
        ?.querySelector<HTMLElement>('[data-settings-agent-detail-heading]')
        ?.focus({ preventScroll: true })
      return
    }
    if (!restoreListRef.current) {
      return
    }
    restoreListRef.current = false
    const returnPoint = returnPointRef.current
    if (content) {
      content.scrollTop = returnPoint?.scrollTop ?? 0
    }
    if (returnPoint) {
      view
        ?.querySelector<HTMLElement>(
          `[data-testid="settings-agent-configure-${returnPoint.provider}"]`,
        )
        ?.focus({ preventScroll: true })
    }
  }, [activeProvider])

  return { viewRef, activeProvider, openProvider, backToList }
}
