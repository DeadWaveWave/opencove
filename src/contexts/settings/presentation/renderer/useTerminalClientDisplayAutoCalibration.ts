import { useEffect, useRef } from 'react'
import type { AgentSettings } from '../../domain/agentSettings'
import {
  createTerminalDisplayProfileKey,
  isTerminalDisplayReferenceForProfile,
} from '../../domain/terminalDisplayCalibration'
import {
  createAutomaticTerminalDisplayCalibration,
  runTerminalDisplayCalibrationSingleFlight,
} from '../../application/terminalDisplayAutoCalibration'
import {
  clearTerminalClientDisplayCalibration,
  isTerminalDisplayCalibrationSuppressed,
  readTerminalClientDisplayCalibration,
  readTerminalDisplayCalibrationStorageMetadata,
  TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT,
  writeTerminalClientDisplayCalibration,
} from './terminalDisplayCalibrationStorage'
import {
  calibrateTerminalDisplayReferenceAutomatically,
  TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED,
} from './terminalDisplayMeasurement'
import { resolveStableTerminalDisplayEnvironment } from './terminalDisplayEnvironment'

export function useTerminalClientDisplayAutoCalibration({
  enabled,
  agentSettings,
}: {
  enabled: boolean
  agentSettings: AgentSettings
}): void {
  const lifecycleGenerationRef = useRef(0)
  const { terminalFontSize, terminalFontFamily, terminalDisplayReference } = agentSettings
  const profileKey = createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  const reference = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })
    ? terminalDisplayReference
    : null
  const referenceSignature = JSON.stringify(reference)

  useEffect(() => {
    if (!enabled || !reference) {
      lifecycleGenerationRef.current += 1
      return undefined
    }

    let disposed = false
    let scheduledFrame: number | null = null
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
    const schedule = (): void => {
      if (disposed || scheduledFrame !== null) {
        return
      }
      lifecycleGenerationRef.current += 1
      const generation = lifecycleGenerationRef.current
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = null
        void attempt(generation)
      })
    }
    const handleDprChange = (): void => {
      armDprQuery()
      schedule()
    }
    const attempt = async (generation: number): Promise<void> => {
      const isCurrent = (): boolean => !disposed && generation === lifecycleGenerationRef.current
      const environment = await resolveStableTerminalDisplayEnvironment({
        terminalFontSize,
        terminalFontFamily,
        reference,
      })
      if (!environment || !isCurrent()) {
        return
      }

      const currentCalibration = readTerminalClientDisplayCalibration({
        terminalFontSize,
        terminalFontFamily,
        terminalDisplayReference: reference,
      })
      const metadata = readTerminalDisplayCalibrationStorageMetadata()
      if (
        currentCalibration &&
        (!metadata || metadata.environmentSignature === environment.signature)
      ) {
        return
      }
      if (metadata && metadata.environmentSignature !== environment.signature) {
        clearTerminalClientDisplayCalibration()
      }
      if (isTerminalDisplayCalibrationSuppressed(environment.signature) || !isCurrent()) {
        return
      }

      const result = await runTerminalDisplayCalibrationSingleFlight(
        environment.signature,
        async () =>
          await calibrateTerminalDisplayReferenceAutomatically({
            terminalFontSize,
            terminalFontFamily,
            reference,
            rendererKind: environment.rendererKind,
          }),
      ).catch(() => null)
      if (!isCurrent()) {
        return
      }
      const confirmedEnvironment = await resolveStableTerminalDisplayEnvironment({
        terminalFontSize,
        terminalFontFamily,
        reference,
      })
      if (
        !confirmedEnvironment ||
        confirmedEnvironment.signature !== environment.signature ||
        !isCurrent() ||
        isTerminalDisplayCalibrationSuppressed(environment.signature)
      ) {
        return
      }

      const calibration = createAutomaticTerminalDisplayCalibration({
        profileKey,
        reference,
        result,
      })
      if (!calibration) {
        return
      }
      writeTerminalClientDisplayCalibration(calibration, {
        environmentSignature: environment.signature,
        source: 'automatic',
      })
    }

    armDprQuery()
    schedule()
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.addEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, schedule)
    window.addEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, schedule)
    document.fonts?.addEventListener('loadingdone', schedule)
    document.fonts?.addEventListener('loadingerror', schedule)

    return () => {
      disposed = true
      lifecycleGenerationRef.current += 1
      if (scheduledFrame !== null) {
        window.cancelAnimationFrame(scheduledFrame)
      }
      cleanupMediaQuery()
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.removeEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, schedule)
      window.removeEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, schedule)
      document.fonts?.removeEventListener('loadingdone', schedule)
      document.fonts?.removeEventListener('loadingerror', schedule)
    }
  }, [enabled, profileKey, reference, referenceSignature, terminalFontFamily, terminalFontSize])
}
