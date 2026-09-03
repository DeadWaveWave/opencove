import { useEffect } from 'react'
import type { AgentSettings } from '../../domain/agentSettings'
import { createTerminalDisplayReferenceSignature } from '../../domain/terminalDisplayCalibration'
import { TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT } from './terminalDisplayCalibrationStorage'
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
  const referenceSignature = createTerminalDisplayReferenceSignature(terminalDisplayReference)

  useEffect(() => {
    let disposed = false
    let scheduledFrame: number | null = null
    let mediaQuery: MediaQueryList | null = null
    const context = {
      enabled,
      terminalFontSize,
      terminalFontFamily,
      reference: terminalDisplayReference,
    }

    const cleanupMediaQuery = (): void => {
      mediaQuery?.removeEventListener('change', handleDprChange)
      mediaQuery = null
    }
    const armDprQuery = (): void => {
      cleanupMediaQuery()
      mediaQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null
      mediaQuery?.addEventListener('change', handleDprChange)
    }
    const schedule = (): void => {
      if (disposed || isTerminalDisplayCalibrationStorageMutationInProgress()) {
        return
      }
      terminalDisplayCalibrationOwner.invalidate()
      if (scheduledFrame !== null) {
        return
      }
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = null
        terminalDisplayCalibrationOwner.refresh()
      })
    }
    const handleDprChange = (): void => {
      armDprQuery()
      schedule()
    }

    terminalDisplayCalibrationOwner.update(context)
    armDprQuery()
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.addEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, schedule)
    window.addEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, schedule)
    window.addEventListener('storage', schedule)
    document.fonts?.addEventListener('loadingdone', schedule)
    document.fonts?.addEventListener('loadingerror', schedule)

    return () => {
      disposed = true
      if (scheduledFrame !== null) {
        window.cancelAnimationFrame(scheduledFrame)
      }
      cleanupMediaQuery()
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.removeEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, schedule)
      window.removeEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, schedule)
      window.removeEventListener('storage', schedule)
      document.fonts?.removeEventListener('loadingdone', schedule)
      document.fonts?.removeEventListener('loadingerror', schedule)
      terminalDisplayCalibrationOwner.update({ ...context, enabled: false })
    }
  }, [enabled, referenceSignature, terminalDisplayReference, terminalFontFamily, terminalFontSize])
}
