import { useEffect, useRef } from 'react'
import type { AgentSettings } from '../../domain/agentSettings'
import {
  createTerminalDisplayProfileKey,
  isTerminalDisplayReferenceForProfile,
} from '../../domain/terminalDisplayCalibration'
import {
  hasMountedTerminalDisplayMeasurementHandle,
  measureTerminalDisplayReferenceBaseline,
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
  const pendingProfileKeysRef = useRef<Set<string>>(new Set())
  const { terminalFontSize, terminalFontFamily, terminalDisplayReference } = agentSettings
  const profileKey = createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  const hasReferenceForProfile = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })

  useEffect(() => {
    const pendingProfileKeys = pendingProfileKeysRef.current
    if (!enabled || hasReferenceForProfile || pendingProfileKeys.has(profileKey)) {
      return undefined
    }

    let disposed = false

    const capture = (): void => {
      if (
        disposed ||
        pendingProfileKeys.has(profileKey) ||
        !hasMountedTerminalDisplayMeasurementHandle()
      ) {
        return
      }

      pendingProfileKeys.add(profileKey)
      void measureTerminalDisplayReferenceBaseline({
        terminalFontSize,
        terminalFontFamily,
      })
        .then(measurement => {
          if (disposed || !measurement) {
            return
          }

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
        })
        .finally(() => {
          pendingProfileKeys.delete(profileKey)
        })
    }

    const frame = window.requestAnimationFrame(capture)
    window.addEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, capture)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      window.removeEventListener(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED, capture)
      pendingProfileKeys.delete(profileKey)
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
