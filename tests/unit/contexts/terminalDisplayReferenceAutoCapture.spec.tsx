import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalDisplayMeasurement } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import { useTerminalDisplayReferenceAutoCapture } from '../../../src/contexts/settings/presentation/renderer/useTerminalDisplayReferenceAutoCapture'
import {
  hasMountedTerminalDisplayMeasurementHandle,
  measureTerminalDisplayReferenceBaseline,
  readTerminalDisplayRuntime,
  resolveMountedTerminalDisplayRendererKind,
} from '../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement'

vi.mock('../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement', () => ({
  TERMINAL_DISPLAY_MEASUREMENT_WIDTH: 638,
  TERMINAL_DISPLAY_MEASUREMENT_HEIGHT: 384,
  TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED:
    'opencove:terminal-display-measurement-handles-changed',
  hasMountedTerminalDisplayMeasurementHandle: vi.fn(() => true),
  measureTerminalDisplayReferenceBaseline: vi.fn(),
  readTerminalDisplayRuntime: vi.fn(() => 'desktop'),
  resolveMountedTerminalDisplayRendererKind: vi.fn(() => 'webgl'),
}))

function createMeasurement(overrides: Partial<TerminalDisplayMeasurement> = {}) {
  return {
    fontSize: 13,
    fontFamily: null,
    lineHeight: 1,
    letterSpacing: 0,
    cols: 81,
    rows: 24,
    cssCellWidth: 7.5,
    cssCellHeight: 15,
    effectiveDpr: 2,
    windowDevicePixelRatio: 1,
    visualViewportScale: 1,
    runtime: 'desktop' as const,
    measuredAt: '2026-04-30T00:00:00.000Z',
    ...overrides,
  }
}

function Harness({
  enabled = true,
  settings,
  setAgentSettings,
}: {
  enabled?: boolean
  settings: AgentSettings
  setAgentSettings: (action: AgentSettings | ((previous: AgentSettings) => AgentSettings)) => void
}): null {
  useTerminalDisplayReferenceAutoCapture({
    enabled,
    agentSettings: settings,
    setAgentSettings,
  })
  return null
}

describe('useTerminalDisplayReferenceAutoCapture', () => {
  beforeEach(() => {
    vi.mocked(hasMountedTerminalDisplayMeasurementHandle).mockReset()
    vi.mocked(hasMountedTerminalDisplayMeasurementHandle).mockReturnValue(true)
    vi.mocked(measureTerminalDisplayReferenceBaseline).mockReset()
    vi.mocked(readTerminalDisplayRuntime).mockReset()
    vi.mocked(readTerminalDisplayRuntime).mockReturnValue('desktop')
    vi.mocked(resolveMountedTerminalDisplayRendererKind).mockReset()
    vi.mocked(resolveMountedTerminalDisplayRendererKind).mockReturnValue('webgl')
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { meta: { runtime: 'electron' } },
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('survives the StrictMode effect replacement while a capture is in flight', async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: null }
    let resolveMeasurement!: (measurement: TerminalDisplayMeasurement) => void
    let nextSettings: AgentSettings | null = null
    vi.mocked(measureTerminalDisplayReferenceBaseline)
      .mockImplementationOnce(
        async () =>
          await new Promise(resolve => {
            resolveMeasurement = resolve
          }),
      )
      .mockResolvedValue(createMeasurement())

    render(
      <React.StrictMode>
        <Harness
          settings={settings}
          setAgentSettings={action => {
            nextSettings = typeof action === 'function' ? action(settings) : action
          }}
        />
      </React.StrictMode>,
    )

    await waitFor(() => expect(resolveMeasurement).toBeTypeOf('function'))
    resolveMeasurement(createMeasurement())
    await waitFor(() => expect(nextSettings?.terminalDisplayReference).not.toBeNull())
  })

  it('captures the current client as the shared reference when none exists', async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: null }
    let nextSettings: AgentSettings | null = null
    vi.mocked(measureTerminalDisplayReferenceBaseline).mockResolvedValue(createMeasurement())

    render(
      <Harness
        settings={settings}
        setAgentSettings={action => {
          nextSettings = typeof action === 'function' ? action(settings) : action
        }}
      />,
    )

    await waitFor(() => expect(nextSettings?.terminalDisplayReference).not.toBeNull())
    expect(nextSettings?.terminalDisplayReference).toMatchObject({
      capture: { algorithmVersion: 1, rendererKind: 'webgl' },
      measurement: {
        cols: 81,
        rows: 24,
        runtime: 'desktop',
      },
    })
  })

  it('waits for a mounted terminal handle before auto-capturing the shared reference', async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: null }
    let nextSettings: AgentSettings | null = null
    let handlesAvailable = false
    vi.mocked(hasMountedTerminalDisplayMeasurementHandle).mockImplementation(() => handlesAvailable)
    vi.mocked(measureTerminalDisplayReferenceBaseline).mockResolvedValue(createMeasurement())

    render(
      <Harness
        settings={settings}
        setAgentSettings={action => {
          nextSettings = typeof action === 'function' ? action(settings) : action
        }}
      />,
    )

    expect(measureTerminalDisplayReferenceBaseline).not.toHaveBeenCalled()

    handlesAvailable = true
    window.dispatchEvent(new Event('opencove:terminal-display-measurement-handles-changed'))

    await waitFor(() => expect(nextSettings?.terminalDisplayReference).not.toBeNull())
    expect(measureTerminalDisplayReferenceBaseline).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a current reference that already matches the appearance profile', () => {
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayReference: {
        version: 1 as const,
        capture: { algorithmVersion: 1 as const, rendererKind: 'webgl' as const },
        measurement: createMeasurement(),
      },
    }
    const setAgentSettings = vi.fn()

    render(<Harness settings={settings} setAgentSettings={setAgentSettings} />)

    expect(measureTerminalDisplayReferenceBaseline).not.toHaveBeenCalled()
    expect(setAgentSettings).not.toHaveBeenCalled()
  })

  it('recaptures a matching-runtime legacy reference with current provenance', async () => {
    const legacyReference = { version: 1 as const, measurement: createMeasurement({ cols: 79 }) }
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: legacyReference }
    let nextSettings: AgentSettings | null = null
    vi.mocked(measureTerminalDisplayReferenceBaseline).mockResolvedValue(
      createMeasurement({ cols: 82 }),
    )

    render(
      <Harness
        settings={settings}
        setAgentSettings={action => {
          nextSettings = typeof action === 'function' ? action(settings) : action
        }}
      />,
    )

    await waitFor(() => expect(nextSettings?.terminalDisplayReference).not.toBe(legacyReference))
    expect(nextSettings?.terminalDisplayReference).toMatchObject({
      capture: { algorithmVersion: 1, rendererKind: 'webgl' },
      measurement: { cols: 82 },
    })
  })

  it('does not let a browser silently replace a legacy desktop reference', () => {
    vi.mocked(readTerminalDisplayRuntime).mockReturnValue('browser')
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayReference: { version: 1 as const, measurement: createMeasurement() },
    }
    const setAgentSettings = vi.fn()

    render(<Harness settings={settings} setAgentSettings={setAgentSettings} />)

    expect(measureTerminalDisplayReferenceBaseline).not.toHaveBeenCalled()
    expect(setAgentSettings).not.toHaveBeenCalled()
  })

  it('does not guess the anchor for a legacy reference with unknown runtime', () => {
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayReference: {
        version: 1 as const,
        measurement: createMeasurement({ runtime: 'unknown' }),
      },
    }
    const setAgentSettings = vi.fn()

    render(<Harness settings={settings} setAgentSettings={setAgentSettings} />)

    expect(measureTerminalDisplayReferenceBaseline).not.toHaveBeenCalled()
    expect(setAgentSettings).not.toHaveBeenCalled()
  })

  it('does not overwrite a concurrent current reference after legacy measurement resolves', async () => {
    const legacyReference = { version: 1 as const, measurement: createMeasurement({ cols: 79 }) }
    const concurrentReference = {
      version: 1 as const,
      capture: { algorithmVersion: 1 as const, rendererKind: 'webgl' as const },
      measurement: createMeasurement({ cols: 83 }),
    }
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: legacyReference }
    let resolveMeasurement!: (measurement: TerminalDisplayMeasurement) => void
    let nextSettings: AgentSettings | null = null
    vi.mocked(measureTerminalDisplayReferenceBaseline).mockImplementation(
      async () =>
        await new Promise(resolve => {
          resolveMeasurement = resolve
        }),
    )

    render(
      <Harness
        settings={settings}
        setAgentSettings={action => {
          const concurrentSettings = {
            ...settings,
            terminalDisplayReference: concurrentReference,
          }
          nextSettings = typeof action === 'function' ? action(concurrentSettings) : action
        }}
      />,
    )

    await waitFor(() => expect(resolveMeasurement).toBeTypeOf('function'))
    resolveMeasurement(createMeasurement({ cols: 82 }))
    await waitFor(() => expect(nextSettings).not.toBeNull())
    expect(nextSettings?.terminalDisplayReference).toBe(concurrentReference)
  })

  it('does not capture a shared reference when automatic alignment is disabled', () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: null }
    const setAgentSettings = vi.fn()
    vi.mocked(measureTerminalDisplayReferenceBaseline).mockResolvedValue(createMeasurement())

    render(<Harness enabled={false} settings={settings} setAgentSettings={setAgentSettings} />)

    expect(measureTerminalDisplayReferenceBaseline).not.toHaveBeenCalled()
    expect(setAgentSettings).not.toHaveBeenCalled()
  })
})
