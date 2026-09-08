import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  resolveSelectableAgentProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import type { SettingsPageId } from './SettingsPanel.shared'
import type { SettingsSearchResult } from './settingsPanel/settingsSearchIndex'

export interface AgentProviderRequest {
  provider?: AgentProvider | null
  key: number
}

/** Reveal through presentation boundaries after the requested detail has mounted. */
export function useSettingsSearchNavigation({
  contentRef,
  activePageId,
  defaultProvider,
  setActivePageId,
}: {
  contentRef: RefObject<HTMLDivElement | null>
  activePageId: SettingsPageId
  defaultProvider: AgentProvider
  setActivePageId: (pageId: SettingsPageId) => void
}) {
  const [pending, setPending] = useState<SettingsSearchResult | null>(null)
  const [agentRequest, setAgentRequest] = useState<AgentProviderRequest>({ key: 0 })
  const cleanupHighlight = useRef<(() => void) | null>(null)
  const selectPage = useCallback(
    (pageId: SettingsPageId) => {
      setPending(null)
      cleanupHighlight.current?.()
      setAgentRequest(previous => ({ provider: null, key: previous.key + 1 }))
      setActivePageId(pageId)
    },
    [setActivePageId],
  )

  const selectSearchResult = (result: SettingsSearchResult) => {
    cleanupHighlight.current?.()
    const provider =
      result.provider === 'default'
        ? resolveSelectableAgentProvider(defaultProvider)
        : (result.provider ?? null)
    setAgentRequest(previous => ({ provider, key: previous.key + 1 }))
    setActivePageId(result.pageId)
    setPending({ ...result, anchorId: result.anchorId.replace('{provider}', provider ?? '') })
  }

  useEffect(() => {
    if (!pending || activePageId !== pending.pageId || !contentRef.current) {
      return
    }
    const scope = contentRef.current
    let frame: number | null = null
    let disposed = false
    let observer: MutationObserver | null = null
    let timeout: number | null = null
    const reveal = () => {
      const target = document.getElementById(pending.anchorId)
      if (disposed || !target || !scope.contains(target)) {
        return
      }
      observer?.disconnect()
      if (timeout !== null) {
        window.clearTimeout(timeout)
      }
      let ancestor: HTMLElement | null = target
      while (ancestor && scope.contains(ancestor)) {
        if (ancestor instanceof HTMLDetailsElement) {
          ancestor.open = true
        }
        ancestor = ancestor.parentElement
      }
      frame = window.requestAnimationFrame(() => {
        if (disposed || !target.isConnected) {
          return
        }
        target.scrollIntoView({ block: 'start' })
        const control = target.matches('input, button, select, textarea')
          ? target
          : target.querySelector<HTMLElement>(
              'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])',
            )
        control?.focus({ preventScroll: true })
        target.setAttribute('data-settings-search-target', 'true')
        const timer = window.setTimeout(
          () => target.removeAttribute('data-settings-search-target'),
          1600,
        )
        cleanupHighlight.current = () => {
          window.clearTimeout(timer)
          target.removeAttribute('data-settings-search-target')
        }
        setPending(current => (current === pending ? null : current))
      })
    }
    observer = new MutationObserver(reveal)
    observer.observe(scope, { childList: true, subtree: true })
    timeout = window.setTimeout(() => observer?.disconnect(), 2000)
    reveal()
    return () => {
      disposed = true
      observer?.disconnect()
      if (timeout !== null) {
        window.clearTimeout(timeout)
      }
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [activePageId, contentRef, pending])

  useEffect(() => () => cleanupHighlight.current?.(), [])
  return { agentRequest, selectPage, selectSearchResult }
}
