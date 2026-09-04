import { useEffect, useRef } from 'react'
import type { AgentSettings } from '../../domain/agentSettings'
import {
  createTerminalDisplayProfileKey,
  createTerminalDisplayReferenceSignature,
} from '../../domain/terminalDisplayCalibration'
import { createTerminalDisplayReferenceCaptureOwner } from '../../application/terminalDisplayReferenceCaptureOwner'
import {
  hasMountedTerminalDisplayMeasurementHandle,
  measureTerminalDisplayReferenceBaseline,
  readTerminalDisplayRuntime,
  resolveMountedTerminalDisplayRendererKind,
  TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED,
} from './terminalDisplayMeasurement'

type SetStateAction<T> = T | ((prev: T) => T)

export function useTerminalDisplayReferenceAutoCapture({
  enabled,
  agentSettings,
  setAgentSettings,
}: {
  enabled: boolean
  agentSettings: AgentSettings
  setAgentSettings: (action: SetStateAction<AgentSettings>) => void
}): void {
  const ownerRef = useRef<ReturnType<typeof createTerminalDisplayReferenceCaptureOwner> | null>(
    null,
  )
  if (!ownerRef.current) {
    ownerRef.current = createTerminalDisplayReferenceCaptureOwner({
      hasMountedTerminal: hasMountedTerminalDisplayMeasurementHandle,
      rendererKind: resolveMountedTerminalDisplayRendererKind,
      measure: measureTerminalDisplayReferenceBaseline,
      commit: ({ expectedProfileKey, expectedReferenceSignature, reference }) => {
        setAgentSettings(previous => {
          const previousProfileKey = createTerminalDisplayProfileKey({
            terminalFontSize: previous.terminalFontSize,
            terminalFontFamily: previous.terminalFontFamily,
          })
          if (
            previousProfileKey !== expectedProfileKey ||
            createTerminalDisplayReferenceSignature(previous.terminalDisplayReference) !==
              expectedReferenceSignature
          ) {
            return previous
          }
          return { ...previous, terminalDisplayReference: reference }
        })
      },
    })
  }

  const { terminalFontSize, terminalFontFamily, terminalDisplayReference } = agentSettings
  const referenceSignature = createTerminalDisplayReferenceSignature(terminalDisplayReference)
  useEffect(() => {
    const owner = ownerRef.current
    if (!owner) {
      return undefined
    }
    owner.update({
      enabled,
      terminalFontSize,
      terminalFontFamily,
      reference: terminalDisplayReference,
      runtime: readTerminalDisplayRuntime(),
    })
    const refresh = (): void => owner.refresh()
    window.addEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, refresh)
    window.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    document.fonts?.addEventListener('loadingdone', refresh)
    document.fonts?.addEventListener('loadingerror', refresh)

    return () => {
      window.removeEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, refresh)
      window.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
      document.fonts?.removeEventListener('loadingdone', refresh)
      document.fonts?.removeEventListener('loadingerror', refresh)
      owner.update({
        enabled: false,
        terminalFontSize,
        terminalFontFamily,
        reference: terminalDisplayReference,
        runtime: readTerminalDisplayRuntime(),
      })
    }
  }, [enabled, referenceSignature, terminalDisplayReference, terminalFontFamily, terminalFontSize])
}
