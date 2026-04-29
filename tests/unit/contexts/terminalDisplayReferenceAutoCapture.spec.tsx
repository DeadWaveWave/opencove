import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalDisplayMeasurement } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import { useTerminalDisplayReferenceAutoCapture } from '../../../src/contexts/settings/presentation/renderer/useTerminalDisplayReferenceAutoCapture'
import { measureFirstMountedTerminalDisplay } from '../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement'

vi.mock('../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement', () => ({
  TERMINAL_DISPLAY_MEASUREMENT_WIDTH: 638,
  TERMINAL_DISPLAY_MEASUREMENT_HEIGHT: 384,
  TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED:
    'opencove:terminal-display-measurement-handles-changed',
  measureFirstMountedTerminalDisplay: vi.fn(),
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
    vi.mocked(measureFirstMountedTerminalDisplay).mockReset()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures the current client as the shared reference when none exists', async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: null }
    let nextSettings: AgentSettings | null = null
    vi.mocked(measureFirstMountedTerminalDisplay).mockReturnValue(createMeasurement())

    render(
      <Harness
        settings={settings}
        setAgentSettings={action => {
          nextSettings = typeof action === 'function' ? action(settings) : action
        }}
      />,
    )

    await waitFor(() => expect(nextSettings?.terminalDisplayReference).not.toBeNull())
    expect(nextSettings?.terminalDisplayReference?.measurement).toMatchObject({
      cols: 81,
      rows: 24,
      runtime: 'desktop',
    })
  })

  it('does not overwrite a reference that already matches the current appearance profile', () => {
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayReference: { version: 1 as const, measurement: createMeasurement() },
    }
    const setAgentSettings = vi.fn()

    render(<Harness settings={settings} setAgentSettings={setAgentSettings} />)

    expect(measureFirstMountedTerminalDisplay).not.toHaveBeenCalled()
    expect(setAgentSettings).not.toHaveBeenCalled()
  })
})
