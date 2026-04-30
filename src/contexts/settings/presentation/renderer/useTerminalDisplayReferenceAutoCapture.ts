import { useEffect, useRef } from 'react'
import type { AgentSettings } from '../../domain/agentSettings'
import {
  createTerminalDisplayProfileKey,
  isTerminalDisplayReferenceForProfile,
} from '../../domain/terminalDisplayCalibration'
import {
  measureFirstMountedTerminalDisplay,
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
  const pendingProfileKeyRef = useRef<string | null>(null)
  const { terminalFontSize, terminalFontFamily, terminalDisplayReference } = agentSettings
  const profileKey = createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  const hasReferenceForProfile = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })

  useEffect(() => {
    if (!enabled || hasReferenceForProfile || pendingProfileKeyRef.current === profileKey) {
      return undefined
    }

    const capture = (): void => {
      const measurement = measureFirstMountedTerminalDisplay({
        terminalFontSize,
        terminalFontFamily,
      })
      if (!measurement) {
        return
      }

      pendingProfileKeyRef.current = profileKey
      setAgentSettings(previous => {
        const previousProfileKey = createTerminalDisplayProfileKey({
          terminalFontSize: previous.terminalFontSize,
          terminalFontFamily: previous.terminalFontFamily,
        })
        if (
          previousProfileKey !== profileKey ||
          isTerminalDisplayReferenceForProfile(previous.terminalDisplayReference, {
            terminalFontSize: previous.terminalFontSize,
            terminalFontFamily: previous.terminalFontFamily,
          })
        ) {
          return previous
        }

        return {
          ...previous,
          terminalDisplayReference: { version: 1, measurement },
        }
      })
      pendingProfileKeyRef.current = null
    }

    const frame = window.requestAnimationFrame(capture)
    window.addEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, capture)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, capture)
      if (pendingProfileKeyRef.current === profileKey) {
        pendingProfileKeyRef.current = null
      }
    }
  }, [
    enabled,
    hasReferenceForProfile,
    profileKey,
    setAgentSettings,
    terminalFontFamily,
    terminalFontSize,
  ])
}
