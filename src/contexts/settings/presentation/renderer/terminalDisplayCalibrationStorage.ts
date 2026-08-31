import { useEffect, useMemo, useState } from 'react'
import {
  createTerminalDisplayCalibrationSignature,
  createTerminalDisplayProfileKey,
  isTerminalDisplayCalibrationForReference,
  isTerminalDisplayReferenceForProfile,
  normalizeTerminalClientDisplayCalibration,
  type TerminalClientDisplayCalibration,
  type TerminalDisplayReference,
} from '../../domain/terminalDisplayCalibration'

export const TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY = 'opencove:terminal-display-calibration:v1'
const ENVIRONMENT_STORAGE_KEY = 'opencove:terminal-display-calibration-environment:v1'
const SUPPRESSION_STORAGE_KEY = 'opencove:terminal-display-calibration-suppression:v1'
export const TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT =
  'opencove:terminal-display-calibration-changed'

export interface TerminalDisplayCalibrationStorageMetadata {
  environmentSignature: string
  source: 'automatic' | 'manual'
}

function readStorageValue(): TerminalClientDisplayCalibration | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)
    return raw ? normalizeTerminalClientDisplayCalibration(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function hasRawCalibration(): boolean {
  try {
    return window.localStorage.getItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export function readTerminalDisplayCalibrationStorageMetadata(): TerminalDisplayCalibrationStorageMetadata | null {
  try {
    const raw = window.localStorage.getItem(ENVIRONMENT_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    const record = value as Record<string, unknown>
    return typeof record.environmentSignature === 'string' &&
      (record.source === 'automatic' || record.source === 'manual')
      ? { environmentSignature: record.environmentSignature, source: record.source }
      : null
  } catch {
    return null
  }
}

export function isTerminalDisplayCalibrationSuppressed(environmentSignature: string): boolean {
  try {
    return window.localStorage.getItem(SUPPRESSION_STORAGE_KEY) === environmentSignature
  } catch {
    return false
  }
}

function emitCalibrationChange(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT))
}

export interface TerminalClientDisplayCalibrationInspection {
  profileKey: string
  rawCalibrationPresent: boolean
  calibrationPresent: boolean
  profileMatches: boolean
  referencePresent: boolean
  referenceMatchesProfile: boolean
  calibrationMatchesReference: boolean
  applicableCalibrationPresent: boolean
  calibrationFontSize: number | null
  calibrationLineHeight: number | null
  calibrationLetterSpacing: number | null
  calibrationScore: number | null
}

export function inspectTerminalClientDisplayCalibration({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}): TerminalClientDisplayCalibrationInspection {
  const calibration = readStorageValue()
  const profileKey = createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  const profileMatches = calibration?.profileKey === profileKey
  const referenceMatchesProfile = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })
  const calibrationMatchesReference =
    profileMatches &&
    referenceMatchesProfile &&
    isTerminalDisplayCalibrationForReference(calibration, terminalDisplayReference)

  return {
    profileKey,
    rawCalibrationPresent: hasRawCalibration(),
    calibrationPresent: calibration !== null,
    profileMatches,
    referencePresent: terminalDisplayReference !== null,
    referenceMatchesProfile,
    calibrationMatchesReference,
    applicableCalibrationPresent: calibrationMatchesReference,
    calibrationFontSize: calibration?.fontSize ?? null,
    calibrationLineHeight: calibration?.lineHeight ?? null,
    calibrationLetterSpacing: calibration?.letterSpacing ?? null,
    calibrationScore: calibration?.score ?? null,
  }
}

export function readTerminalClientDisplayCalibration({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}): TerminalClientDisplayCalibration | null {
  const calibration = readStorageValue()
  if (!calibration) {
    return null
  }

  const profileKey = createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  if (calibration.profileKey !== profileKey) {
    return null
  }

  if (
    !isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
      terminalFontSize,
      terminalFontFamily,
    })
  ) {
    return null
  }

  return isTerminalDisplayCalibrationForReference(calibration, terminalDisplayReference)
    ? calibration
    : null
}

export function writeTerminalClientDisplayCalibration(
  calibration: TerminalClientDisplayCalibration,
  metadata?: TerminalDisplayCalibrationStorageMetadata,
): void {
  try {
    window.localStorage.setItem(
      TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY,
      JSON.stringify(calibration),
    )
    if (metadata) {
      window.localStorage.setItem(ENVIRONMENT_STORAGE_KEY, JSON.stringify(metadata))
      if (window.localStorage.getItem(SUPPRESSION_STORAGE_KEY) === metadata.environmentSignature) {
        window.localStorage.removeItem(SUPPRESSION_STORAGE_KEY)
      }
    } else {
      window.localStorage.removeItem(ENVIRONMENT_STORAGE_KEY)
      window.localStorage.removeItem(SUPPRESSION_STORAGE_KEY)
    }
    emitCalibrationChange()
  } catch {
    // Client-local calibration is optional; storage denial keeps default terminal metrics.
  }
}

export function clearTerminalClientDisplayCalibration(options?: {
  suppressEnvironmentSignature?: string | null
}): void {
  try {
    if (options?.suppressEnvironmentSignature) {
      window.localStorage.setItem(SUPPRESSION_STORAGE_KEY, options.suppressEnvironmentSignature)
    }
    window.localStorage.removeItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)
    window.localStorage.removeItem(ENVIRONMENT_STORAGE_KEY)
    emitCalibrationChange()
  } catch {
    // Client-local calibration is optional; storage denial keeps current in-memory metrics.
  }
}

export function useTerminalClientDisplayCalibration({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}): TerminalClientDisplayCalibration | null {
  const profileKey = useMemo(
    () => createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily }),
    [terminalFontFamily, terminalFontSize],
  )
  const referenceSignature = useMemo(
    () => JSON.stringify(terminalDisplayReference ?? null),
    [terminalDisplayReference],
  )
  const [calibration, setCalibration] = useState(() =>
    readTerminalClientDisplayCalibration({
      terminalFontSize,
      terminalFontFamily,
      terminalDisplayReference,
    }),
  )

  useEffect(() => {
    const refresh = (): void => {
      setCalibration(current => {
        const next = readTerminalClientDisplayCalibration({
          terminalFontSize,
          terminalFontFamily,
          terminalDisplayReference,
        })

        return createTerminalDisplayCalibrationSignature(current) ===
          createTerminalDisplayCalibrationSignature(next)
          ? current
          : next
      })
    }
    refresh()
    window.addEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [
    profileKey,
    referenceSignature,
    terminalDisplayReference,
    terminalFontFamily,
    terminalFontSize,
  ])

  return calibration
}
