import { useCallback, useEffect, useRef, useState } from 'react'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'
import { useAppStore } from '../store/useAppStore'

export function useSettingsPageNavigation({
  closeTransientOverlays,
  closeSidebar,
  flushPersistNow,
}: {
  closeTransientOverlays: () => void
  closeSidebar: () => void
  flushPersistNow: () => void
}) {
  const { isSettingsOpen, setIsSettingsOpen, setSettingsOpenPageId } = useAppStore()
  const [isFocusNodeTargetZoomPreviewing, setFocusNodeZoomPreviewing] = useState(false)
  const [settingsInitialPageId, setSettingsInitialPageId] = useState<SettingsPageId | null>(null)
  const wasOpenRef = useRef(isSettingsOpen)

  useEffect(() => {
    if (isSettingsOpen) {
      closeSidebar()
    } else {
      setFocusNodeZoomPreviewing(false)
      setSettingsInitialPageId(null)
      setSettingsOpenPageId(null)
      if (wasOpenRef.current) {
        flushPersistNow()
      }
    }
    wasOpenRef.current = isSettingsOpen
  }, [closeSidebar, flushPersistNow, isSettingsOpen, setSettingsOpenPageId])

  const handleOpenSettings = useCallback(
    (initialPageId: SettingsPageId | null = null) => {
      closeTransientOverlays()
      closeSidebar()
      setFocusNodeZoomPreviewing(false)
      setSettingsInitialPageId(initialPageId)
      setSettingsOpenPageId(null)
      setIsSettingsOpen(true)
    },
    [closeSidebar, closeTransientOverlays, setIsSettingsOpen, setSettingsOpenPageId],
  )
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), [setIsSettingsOpen])

  return {
    isFocusNodeTargetZoomPreviewing,
    setFocusNodeZoomPreviewing,
    settingsInitialPageId,
    handleOpenSettings,
    handleCloseSettings,
  }
}
