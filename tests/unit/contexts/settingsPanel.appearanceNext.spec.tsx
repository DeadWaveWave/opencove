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

describe('appearance families and terminal scope', () => {
  it('exposes the seven existing themes as three explicit pairs and independent System', () => {
    const onChange = vi.fn()
    const view = render(<ThemeGallery value="pixel-light" onChange={onChange} />)
    expect(screen.getAllByRole('button')).toHaveLength(UI_THEMES.length)
    for (const theme of UI_THEMES) {
      expect(screen.getByTestId(`settings-ui-theme-${theme}`)).toBeVisible()
    }
    expect(screen.getByRole('button', { name: 'Pixel Light' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Follow System' }))
    expect(onChange).toHaveBeenLastCalledWith('system')
    view.rerender(<ThemeGallery value="system" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Follow System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Pixel Light' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ember' }))
    expect(onChange).toHaveBeenLastCalledWith('ember')
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

  it('localizes the independent System option without inventing a Pixel automatic mode', async () => {
    await applyUiLanguage('zh-CN')
    render(<ThemeGallery value="pixel" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '跟随系统' })).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(7)
    expect(screen.getByText('标准')).toBeVisible()
  })
})
