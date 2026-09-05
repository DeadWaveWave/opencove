import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import type { TerminalDisplayCalibrationOwnerSnapshot } from '../../../src/contexts/settings/application/terminalDisplayCalibrationOwner'

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }))
vi.mock(
  '../../../src/contexts/settings/presentation/renderer/useTerminalDisplayCalibrationProjection',
  () => ({
    useTerminalDisplayCalibrationSnapshot: mocks.snapshot,
    useTerminalDisplayCalibrationProjection: () => null,
  }),
)

import { TerminalDisplayCalibrationRow } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/TerminalDisplayCalibrationRow'

describe('terminal calibration current status', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await applyUiLanguage('en')
  })

  it.each([
    ['en', 'mixed-renderers', 'different display methods'],
    ['zh-CN', 'mixed-renderers', '不同的显示方式'],
    ['en', 'checking', 'Checking the current terminal display'],
    ['zh-CN', 'checking', '正在检查当前终端显示'],
    ['en', 'no-terminal', 'Open a terminal'],
    ['zh-CN', 'no-terminal', '打开一个终端'],
    ['en', 'environment-unstable', 'has not stabilized'],
    ['zh-CN', 'environment-unstable', '终端显示尚未稳定'],
  ] as const)('shows and copies the current %s %s state', async (language, status, text) => {
    await applyUiLanguage(language)
    const snapshot: TerminalDisplayCalibrationOwnerSnapshot = {
      appliedCalibration: null,
      environmentSignature: null,
      status,
    }
    mocks.snapshot.mockReturnValue(snapshot)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
    render(
      <TerminalDisplayCalibrationRow
        terminalFontSize={13}
        terminalFontFamily={null}
        terminalDisplayAutoReferenceEnabled={false}
        terminalDisplayCalibrationCompensationEnabled={true}
        terminalDisplayReference={null}
        onChangeTerminalDisplayAutoReferenceEnabled={() => undefined}
        onChangeTerminalDisplayCalibrationCompensationEnabled={() => undefined}
        onChangeTerminalDisplayReference={() => undefined}
      />,
    )
    expect(screen.getByTestId('settings-terminal-display-summary')).toHaveTextContent(text)
    expect(screen.getByTestId('settings-terminal-display-summary')).toHaveAttribute(
      'data-calibration-state',
      status,
    )
    fireEvent.click(screen.getByTestId('settings-terminal-display-copy-diagnostics'))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({
      currentCalibrationState: { status, environmentSignature: null },
      clientCalibration: null,
      clientCalibrationInspection: { applicableCalibrationPresent: false },
    })
  })
})
