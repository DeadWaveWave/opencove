import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { ThemeGallery } from '@contexts/settings/presentation/renderer/settingsPanel/ThemeGallery'
import { TerminalSettingsSection } from '@contexts/settings/presentation/renderer/settingsPanel/TerminalSettingsSection'
import { UI_THEMES } from '@contexts/settings/domain/agentSettings'

vi.mock('@app/renderer/shell/hooks/useSystemFonts', () => ({
  useSystemFonts: () => ({ fonts: [], isLoading: false }),
}))
vi.mock(
  '@contexts/settings/presentation/renderer/settingsPanel/TerminalDisplayCalibrationRow',
  () => ({
    TerminalDisplayCalibrationRow: () => <div data-testid="calibration-owner-view" />,
  }),
)

beforeEach(async () => {
  await applyUiLanguage('en')
})
afterEach(async () => {
  await applyUiLanguage('en')
  vi.restoreAllMocks()
})

describe('appearance and terminal scope', () => {
  it("offers Cove's three appearances as one radio group, with no theme families", () => {
    const onChange = vi.fn()
    const view = render(<ThemeGallery value="light" onChange={onChange} />)
    const modes = screen.getByRole('radiogroup', { name: 'Appearance' })
    expect(modes).toBeVisible()
    expect(screen.getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual([
      'light',
      'dark',
      'system',
    ])
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(onChange).toHaveBeenLastCalledWith('dark')
    fireEvent.click(screen.getByRole('radio', { name: 'Follow System' }))
    expect(onChange).toHaveBeenLastCalledWith('system')

    view.rerender(<ThemeGallery value="system" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Follow System' })).toBeChecked()
    expect(
      screen.getByText('Follow System switches with your system’s light and dark appearance.'),
    ).toBeVisible()
    // Pixel is retired: its look is Cove's own now, so there is no family to pick.
    expect(view.container.querySelector('[data-theme-family]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pixel' })).toBeNull()
    for (const theme of UI_THEMES) {
      expect(screen.queryByTestId(`settings-ui-theme-${theme}`)).toBeNull()
    }
  })

  it('shows a local typography sample and preserves font and shell change callbacks', () => {
    const changeFont = vi.fn()
    const changeProfile = vi.fn()
    const props = {
      terminalFontSize: 16,
      terminalFontFamily: 'Consolas',
      terminalDisplayAutoReferenceEnabled: true,
      terminalDisplayCalibrationCompensationEnabled: true,
      terminalDisplayReference: null,
      defaultTerminalProfileId: null,
      terminalProfiles: [{ id: 'pwsh', label: 'PowerShell', runtimeKind: 'windows' as const }],
      detectedDefaultTerminalProfileId: 'pwsh',
      onChangeTerminalFontSize: changeFont,
      onChangeTerminalFontFamily: vi.fn(),
      onChangeTerminalDisplayAutoReferenceEnabled: vi.fn(),
      onChangeTerminalDisplayCalibrationCompensationEnabled: vi.fn(),
      onChangeTerminalDisplayReference: vi.fn(),
      onChangeDefaultTerminalProfileId: changeProfile,
    }
    render(<TerminalSettingsSection {...props} />)
    expect(screen.getByRole('img', { name: 'Terminal font preview' })).toBeVisible()
    expect(screen.getByTestId('settings-terminal-typography-content')).toHaveStyle({
      fontFamily: 'Consolas',
      fontSize: '16px',
    })
    expect(screen.getByText('Font changes apply to new terminal and agent sessions.')).toBeVisible()
    expect(screen.queryByTestId('settings-ui-font-size')).toBeNull()
    expect(screen.queryByTestId('settings-standard-window-size-trigger')).toBeNull()
    fireEvent.change(screen.getByTestId('settings-terminal-font-size'), { target: { value: '18' } })
    expect(changeFont).toHaveBeenLastCalledWith(18)
    fireEvent.click(screen.getByTestId('settings-terminal-profile-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'PowerShell' }))
    expect(changeProfile).toHaveBeenLastCalledWith('pwsh')
    expect(screen.getByTestId('settings-terminal-calibration-disclosure')).not.toHaveAttribute(
      'open',
    )
    expect(screen.getByTestId('calibration-owner-view')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('localizes the appearance row', async () => {
    await applyUiLanguage('zh-CN')
    render(<ThemeGallery value="dark" onChange={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: '外观' })).toBeVisible()
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: '深色' })).toBeChecked()
    expect(screen.getByText('跟随系统时随系统的浅色和深色切换。')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Pixel' })).toBeNull()
  })
})
