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
  it('picks a family on the cards and the appearance on one segmented row', () => {
    const onChange = vi.fn()
    const view = render(<ThemeGallery value="pixel-light" onChange={onChange} />)
    const pressed = () =>
      [...view.container.querySelectorAll<HTMLElement>('[data-theme-family]')].map(family => [
        family.dataset.themeFamily,
        family.getAttribute('aria-pressed'),
      ])
    expect(pressed()).toEqual([
      ['cove', 'false'],
      ['pixel', 'true'],
    ])
    const modes = screen.getByRole('radiogroup', { name: 'Appearance' })
    expect(modes).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    // Pixel has light and dark only.
    expect(screen.getByRole('radio', { name: 'Follow System' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(onChange).toHaveBeenLastCalledWith('pixel')
    // Switching family keeps the appearance.
    fireEvent.click(screen.getByRole('button', { name: 'Cove' }))
    expect(onChange).toHaveBeenLastCalledWith('light')

    view.rerender(<ThemeGallery value="dark" onChange={onChange} />)
    expect(pressed()).toEqual([
      ['cove', 'true'],
      ['pixel', 'false'],
    ])
    fireEvent.click(screen.getByRole('radio', { name: 'Follow System' }))
    expect(onChange).toHaveBeenLastCalledWith('system')
    view.rerender(<ThemeGallery value="system" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Follow System' })).toBeChecked()
    expect(
      screen.getByText(
        'Follow System switches with your system’s light and dark appearance. Pixel has light and dark only.',
      ),
    ).toBeVisible()
    for (const theme of UI_THEMES.filter(id => id !== 'system')) {
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

  it('localizes the appearance row without inventing a Pixel automatic mode', async () => {
    await applyUiLanguage('zh-CN')
    render(<ThemeGallery value="pixel" onChange={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: '外观' })).toBeVisible()
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '深色' })).toBeChecked()
    expect(
      screen.getByText('跟随系统时随系统的浅色和深色切换；Pixel 只有浅色和深色。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cove' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Pixel' })).toHaveAttribute('aria-pressed', 'true')
  })
})
