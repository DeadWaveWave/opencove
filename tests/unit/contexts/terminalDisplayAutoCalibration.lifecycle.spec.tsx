import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalDisplayReference } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import {
  clearTerminalClientDisplayCalibration,
  readTerminalDisplayCalibrationStorageMetadata,
  TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY,
} from '../../../src/contexts/settings/presentation/renderer/terminalDisplayCalibrationStorage'

const mocks = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(),
  calibrate: vi.fn(),
}))

vi.mock('../../../src/contexts/settings/presentation/renderer/terminalDisplayEnvironment', () => ({
  resolveStableTerminalDisplayEnvironment: mocks.resolveEnvironment,
}))
vi.mock('../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement', () => ({
  calibrateTerminalDisplayReferenceAutomatically: mocks.calibrate,
  TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED:
    'opencove:terminal-display-measurement-handles-changed',
}))

import { useTerminalClientDisplayAutoCalibration } from '../../../src/contexts/settings/presentation/renderer/useTerminalClientDisplayAutoCalibration'

const reference: TerminalDisplayReference = {
  version: 1,
  measurement: {
    fontSize: 13,
    fontFamily: null,
    lineHeight: 1,
    letterSpacing: 0,
    cols: 80,
    rows: 24,
    cssCellWidth: 7.8,
    cssCellHeight: 15.6,
    effectiveDpr: 1,
    windowDevicePixelRatio: 1,
    visualViewportScale: 1,
    runtime: 'browser',
    measuredAt: '2026-08-31T00:00:00.000Z',
  },
}

function installBrowserPrimitives(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    setTimeout(() => callback(0), 0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      matches: true,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

function settings() {
  return {
    ...DEFAULT_AGENT_SETTINGS,
    terminalFontSize: 13,
    terminalFontFamily: null,
    terminalDisplayReference: reference,
    terminalDisplayCalibrationCompensationEnabled: true,
  }
}

function environment(signature: string) {
  return {
    signature,
    rendererKind: 'dom' as const,
    measurement: { ...reference.measurement },
  }
}

function candidate() {
  return {
    candidate: { fontSize: 13.25, lineHeight: 1, letterSpacing: 0 },
    measurement: { ...reference.measurement, measuredAt: '2026-08-31T00:00:01.000Z' },
    score: 0.5,
    preferenceDistance: 0.25,
  }
}

describe('useTerminalClientDisplayAutoCalibration', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.resolveEnvironment.mockReset().mockResolvedValue(environment('environment-one'))
    mocks.calibrate.mockReset().mockResolvedValue(candidate())
    installBrowserPrimitives()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('automatically persists one high-confidence local calibration', async () => {
    renderHook(() =>
      useTerminalClientDisplayAutoCalibration({ enabled: true, agentSettings: settings() }),
    )

    await waitFor(() => {
      expect(window.localStorage.getItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)).not.toBeNull()
    })
    expect(mocks.calibrate).toHaveBeenCalledTimes(1)
    expect(readTerminalDisplayCalibrationStorageMetadata()).toEqual({
      environmentSignature: 'environment-one',
      source: 'automatic',
    })
  })

  it('fences an in-flight result after the renderer environment changes', async () => {
    let currentSignature = 'environment-one'
    mocks.resolveEnvironment.mockImplementation(async () => environment(currentSignature))
    let resolveFirst!: (value: ReturnType<typeof candidate>) => void
    mocks.calibrate
      .mockImplementationOnce(
        async () =>
          await new Promise<ReturnType<typeof candidate>>(resolvePromise => {
            resolveFirst = resolvePromise
          }),
      )
      .mockResolvedValueOnce(null)

    renderHook(() =>
      useTerminalClientDisplayAutoCalibration({ enabled: true, agentSettings: settings() }),
    )
    await waitFor(() => expect(mocks.calibrate).toHaveBeenCalledTimes(1))

    currentSignature = 'environment-two'
    act(() => window.dispatchEvent(new Event('resize')))
    await waitFor(() => expect(mocks.calibrate).toHaveBeenCalledTimes(2))
    resolveFirst(candidate())
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(window.localStorage.getItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)).toBeNull()
  })

  it('does not recreate a calibration suppressed for the current environment', async () => {
    clearTerminalClientDisplayCalibration({
      suppressEnvironmentSignature: 'environment-one',
    })

    renderHook(() =>
      useTerminalClientDisplayAutoCalibration({ enabled: true, agentSettings: settings() }),
    )
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(mocks.calibrate).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(TERMINAL_DISPLAY_CALIBRATION_STORAGE_KEY)).toBeNull()
  })
})
