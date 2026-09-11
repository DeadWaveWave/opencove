import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MAX_WORKSPACE_SEARCH_PANEL_WIDTH,
  MIN_WORKSPACE_SEARCH_PANEL_WIDTH,
} from '@contexts/settings/domain/agentSettings'

function clampWidth(value: number): number {
  return Math.max(
    MIN_WORKSPACE_SEARCH_PANEL_WIDTH,
    Math.min(MAX_WORKSPACE_SEARCH_PANEL_WIDTH, Math.round(value)),
  )
}

function isInput(element: HTMLElement): boolean {
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

export function useWorkspaceSearchSurface({
  isOpen,
  isCompact,
  panelWidth,
  onPanelWidthChange,
}: {
  isOpen: boolean
  isCompact: boolean
  panelWidth: number
  onPanelWidthChange: (width: number) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const compactRef = useRef(isCompact)
  const wasOpenRef = useRef(false)
  if (isOpen && (!wasOpenRef.current || compactRef.current !== isCompact)) {
    const previous = document.activeElement
    const current = previous instanceof HTMLElement ? previous : null
    const candidate =
      current && panelRef.current?.contains(current) ? returnFocusRef.current : current
    returnFocusRef.current =
      candidate?.closest('.command-center') || (isCompact && (!candidate || isInput(candidate)))
        ? document.querySelector<HTMLElement>('[data-testid="app-header-command-center"]')
        : candidate
  }
  wasOpenRef.current = isOpen
  compactRef.current = isCompact
  const [draftWidth, setDraftWidth] = useState(panelWidth)
  const widthRef = useRef(panelWidth)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!resizeCleanupRef.current) {
      setDraftWidth(panelWidth)
      widthRef.current = panelWidth
    }
  }, [panelWidth])

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }
    return () => {
      const previous = returnFocusRef.current
      if (!compactRef.current && previous?.isConnected) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || isCompact) {
      return
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && !panelRef.current?.contains(target)) {
        returnFocusRef.current = target
      }
    }
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [isCompact, isOpen])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
      resizeCleanupRef.current = null
    }
  }, [isCompact, isOpen])

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (isCompact || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = clampWidth(widthRef.current)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    const cleanup = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      resizeCleanupRef.current = null
    }
    const handlePointerMove = (moveEvent: PointerEvent): void => {
      widthRef.current = clampWidth(startWidth + startX - moveEvent.clientX)
      setDraftWidth(widthRef.current)
    }
    const handlePointerUp = (): void => {
      cleanup()
      onPanelWidthChange(widthRef.current)
    }
    const handlePointerCancel = (): void => {
      cleanup()
      widthRef.current = startWidth
      setDraftWidth(startWidth)
    }
    resizeCleanupRef.current = handlePointerCancel
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerCancel, { once: true })
  }

  return {
    panelRef,
    inputRef,
    closeRef,
    returnFocusRef,
    width: clampWidth(draftWidth),
    onResizeStart,
  }
}
