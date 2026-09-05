import { useEffect, useRef } from 'react'
import type { AgentSettings } from '../../domain/agentSettings'
import {
  isTerminalDisplayCalibrationStorageKey,
  TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT,
} from './terminalDisplayCalibrationStorage'
import {
  isTerminalDisplayCalibrationStorageMutationInProgress,
  terminalDisplayCalibrationOwner,
} from './terminalDisplayCalibrationRuntime'
import { TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED } from './terminalDisplayMeasurement'

export function useTerminalClientDisplayAutoCalibration({
  enabled,
  agentSettings,
}: {
  enabled: boolean
  agentSettings: AgentSettings
}): void {
  const { terminalFontSize, terminalFontFamily, terminalDisplayReference } = agentSettings
  const contextRef = useRef({
    enabled,
    terminalFontSize,
    terminalFontFamily,
    reference: terminalDisplayReference,
  })

  useEffect(() => {
    const context = {
      enabled,
      terminalFontSize,
      terminalFontFamily,
      reference: terminalDisplayReference,
    }
    contextRef.current = context
    terminalDisplayCalibrationOwner.update(context)
  }, [enabled, terminalFontSize, terminalFontFamily, terminalDisplayReference])

  useEffect(() => {
    let mediaQuery: MediaQueryList | null = null
    const cleanupMediaQuery = (): void => {
      mediaQuery?.removeEventListener('change', handleDprChange)
      mediaQuery = null
    }
    const armDprQuery = (): void => {
      cleanupMediaQuery()
      mediaQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null
      mediaQuery?.addEventListener('change', handleDprChange)
    }
    const refresh = (): void => {
      if (isTerminalDisplayCalibrationStorageMutationInProgress()) {
        return
      }
      terminalDisplayCalibrationOwner.refresh()
    }
    const observe = (): void => terminalDisplayCalibrationOwner.observeEnvironment()
    const handleStorage = (event: StorageEvent): void => {
      if (isTerminalDisplayCalibrationStorageKey(event.key)) {
        refresh()
      }
    }
    const handleDprChange = (): void => {
      armDprQuery()
      observe()
    }

    armDprQuery()
    window.addEventListener('resize', observe)
    window.visualViewport?.addEventListener('resize', observe)
    window.addEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, observe)
    window.addEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, refresh)
    window.addEventListener('storage', handleStorage)
    document.fonts?.addEventListener('loading', refresh)
    document.fonts?.addEventListener('loadingdone', refresh)
    document.fonts?.addEventListener('loadingerror', refresh)

    return () => {
      cleanupMediaQuery()
      window.removeEventListener('resize', observe)
      window.visualViewport?.removeEventListener('resize', observe)
      window.removeEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, observe)
      window.removeEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, refresh)
      window.removeEventListener('storage', handleStorage)
      document.fonts?.removeEventListener('loading', refresh)
      document.fonts?.removeEventListener('loadingdone', refresh)
      document.fonts?.removeEventListener('loadingerror', refresh)
      terminalDisplayCalibrationOwner.update({ ...contextRef.current, enabled: false })
    }
  }, [])
}
