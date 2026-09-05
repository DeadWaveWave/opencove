import { useEffect, useState } from 'react'
import type {
  StoredTerminalDisplayCalibration,
  TerminalDisplayCalibrationMetadata,
} from '../../application/terminalDisplayCalibrationOwner'
import {
  createTerminalDisplayProfileKey,
  isTerminalDisplayCalibrationForReference,
  isTerminalDisplayReferenceCurrent,
  isTerminalDisplayReferenceForProfile,
  normalizeTerminalClientDisplayCalibration,
  type TerminalClientDisplayCalibration,
  type TerminalDisplayReference,
} from '../../domain/terminalDisplayCalibration'

export const TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY = 'opencove:terminal-display-calibration:v1'
const ENVIRONMENT_STORAGE_KEY = 'opencove:terminal-display-calibration-environment:v1'
const SUPPRESSION_STORAGE_KEY = 'opencove:terminal-display-calibration-suppression:v1'
export function isTerminalDisplayCalibrationStorageKey(key: string | null): boolean {
  return (
    key === null ||
    key === TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY ||
    key === ENVIRONMENT_STORAGE_KEY ||
    key === SUPPRESSION_STORAGE_KEY
  )
}
export const TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT =
  'opencove:terminal-display-calibration-changed'

export type TerminalDisplayCalibrationStorageMetadata = TerminalDisplayCalibrationMetadata

type AtomicCalibrationProof = TerminalDisplayCalibrationStorageMetadata & { version: 1 }

function normalizeStorageMetadata(
  value: unknown,
): TerminalDisplayCalibrationStorageMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  return typeof record.environmentSignature === 'string' &&
    record.environmentSignature.length > 0 &&
    (record.source === 'automatic' || record.source === 'manual')
    ? { environmentSignature: record.environmentSignature, source: record.source }
    : null
}

export function readStoredTerminalDisplayCalibration(): StoredTerminalDisplayCalibration | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as unknown
    const calibration = normalizeTerminalClientDisplayCalibration(parsed)
    if (!calibration) {
      return null
    }
    const verification =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).verification
        : null
    const atomicMetadata =
      verification &&
      typeof verification === 'object' &&
      !Array.isArray(verification) &&
      (verification as Record<string, unknown>).version === 1
        ? normalizeStorageMetadata(verification)
        : null
    if (atomicMetadata) {
      return { calibration, metadata: atomicMetadata, proof: 'atomic' }
    }
    const legacyMetadata = readLegacyStorageMetadata()
    return {
      calibration,
      metadata: legacyMetadata,
      proof: legacyMetadata ? 'legacy' : null,
    }
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

function readLegacyStorageMetadata(): TerminalDisplayCalibrationStorageMetadata | null {
  try {
    const raw = window.localStorage.getItem(ENVIRONMENT_STORAGE_KEY)
    return raw ? normalizeStorageMetadata(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function readTerminalDisplayCalibrationStorageMetadata(): TerminalDisplayCalibrationStorageMetadata | null {
  return readStoredTerminalDisplayCalibration()?.metadata ?? readLegacyStorageMetadata()
}

export function readTerminalDisplayCalibrationSuppression(): string | null {
  try {
    return window.localStorage.getItem(SUPPRESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

export function isTerminalDisplayCalibrationSuppressed(environmentSignature: string): boolean {
  return readTerminalDisplayCalibrationSuppression() === environmentSignature
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
  referenceUsesCurrentAlgorithm: boolean
  calibrationMatchesReference: boolean
  atomicProofPresent: boolean
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
  const stored = readStoredTerminalDisplayCalibration()
  const calibration = stored?.calibration ?? null
  const profileKey = createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  const profileMatches = calibration?.profileKey === profileKey
  const referenceMatchesProfile = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })
  const referenceUsesCurrentAlgorithm = isTerminalDisplayReferenceCurrent(terminalDisplayReference)
  const calibrationMatchesReference =
    profileMatches &&
    referenceMatchesProfile &&
    referenceUsesCurrentAlgorithm &&
    isTerminalDisplayCalibrationForReference(calibration, terminalDisplayReference)

  return {
    profileKey,
    rawCalibrationPresent: hasRawCalibration(),
    calibrationPresent: calibration !== null,
    profileMatches,
    referencePresent: terminalDisplayReference !== null,
    referenceMatchesProfile,
    referenceUsesCurrentAlgorithm,
    calibrationMatchesReference,
    atomicProofPresent: stored?.proof === 'atomic',
    applicableCalibrationPresent: false,
    calibrationFontSize: calibration?.fontSize ?? null,
    calibrationLineHeight: calibration?.lineHeight ?? null,
    calibrationLetterSpacing: calibration?.letterSpacing ?? null,
    calibrationScore: calibration?.score ?? null,
  }
}

export function writeTerminalClientDisplayCalibration(
  calibration: TerminalClientDisplayCalibration,
  metadata?: TerminalDisplayCalibrationStorageMetadata,
): boolean {
  const storedValue = metadata
    ? {
        ...calibration,
        verification: {
          version: 1,
          ...metadata,
        } satisfies AtomicCalibrationProof,
      }
    : calibration
  try {
    window.localStorage.setItem(
      TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY,
      JSON.stringify(storedValue),
    )
  } catch {
    return false
  }

  try {
    if (metadata) {
      window.localStorage.setItem(ENVIRONMENT_STORAGE_KEY, JSON.stringify(metadata))
      if (window.localStorage.getItem(SUPPRESSION_STORAGE_KEY) === metadata.environmentSignature) {
        window.localStorage.removeItem(SUPPRESSION_STORAGE_KEY)
      }
    } else {
      window.localStorage.removeItem(ENVIRONMENT_STORAGE_KEY)
      window.localStorage.removeItem(SUPPRESSION_STORAGE_KEY)
    }
  } catch {
    // The atomic proof travels with the calibration. The sidecar is legacy diagnostics only.
  }
  emitCalibrationChange()
  return true
}

export function clearTerminalClientDisplayCalibration(options?: {
  suppressEnvironmentSignature?: string | null
}): boolean {
  try {
    if (options?.suppressEnvironmentSignature) {
      window.localStorage.setItem(SUPPRESSION_STORAGE_KEY, options.suppressEnvironmentSignature)
    }
    window.localStorage.removeItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)
    window.localStorage.removeItem(ENVIRONMENT_STORAGE_KEY)
    emitCalibrationChange()
    return true
  } catch {
    return false
  }
}

export function useTerminalClientDisplayCalibrationInspection({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}): TerminalClientDisplayCalibrationInspection {
  const [, setStorageRevision] = useState(0)

  useEffect(() => {
    const refresh = (): void => setStorageRevision(current => current + 1)
    window.addEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(TERMINAL_DISPLAY_CALIBRATION_CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return inspectTerminalClientDisplayCalibration({
    terminalFontSize,
    terminalFontFamily,
    terminalDisplayReference,
  })
}
