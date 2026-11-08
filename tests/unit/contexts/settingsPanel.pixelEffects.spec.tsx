import React, { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import {
  normalizeAgentSettings,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'

function Harness({
  initial,
  onChange = () => undefined,
}: {
  initial: AgentSettings
  onChange?: (settings: AgentSettings) => void
}) {
  const [settings, setSettings] = useState(initial)
  return (
    <SettingsPanel
      initialPageId="appearance"
      settings={settings}
      updateState={null}
      modelCatalogByProvider={
        {} as React.ComponentProps<typeof SettingsPanel>['modelCatalogByProvider']
      }
      workspaces={[]}
      onWorkspaceWorktreesRootChange={() => undefined}
      onWorkspaceEnvironmentVariablesChange={() => undefined}
      isFocusNodeTargetZoomPreviewing={false}
      onFocusNodeTargetZoomPreviewChange={() => undefined}
      onChange={next => {
        setSettings(next)
        onChange(next)
      }}
      onCheckForUpdates={() => undefined}
      onDownloadUpdate={() => undefined}
      onInstallUpdate={() => undefined}
      onClose={() => undefined}
    />
  )
}

beforeEach(async () => {
  await applyUiLanguage('en')
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await applyUiLanguage('en')
})

function backgroundStyle(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Background' })).getByRole('radio', { name })
}

describe('independent Pixel effect controls in Appearance', () => {
  it.each(['dark', 'light', 'system', 'pixel', 'pixel-light'])(
    'exposes the background style, twinkle and three effect switches for the %s theme',
    uiTheme => {
      render(<Harness initial={normalizeAgentSettings({ uiTheme })} />, {
        wrapper: EndpointOverviewProvider,
      })
      const legacyPixel = uiTheme === 'pixel' || uiTheme === 'pixel-light'
      for (const label of ['Node Creation Effect', 'Node Closing Effect', 'Agent Working Effect']) {
        const control = screen.getByRole('switch', { name: label })
        expect(control).toBeEnabled()
        expect(control).toHaveProperty('checked', legacyPixel)
      }
      expect(backgroundStyle(legacyPixel ? 'Pixel' : 'Off')).toBeChecked()
      // Twinkle belongs to the pixel wall.
      const twinkle = screen.getByRole('switch', { name: 'Background Twinkle' })
      expect(twinkle).toBeChecked()
      expect(twinkle).toHaveProperty('disabled', !legacyPixel)
    },
  )

  it('updates only the chosen setting and retains choices when the theme changes', () => {
    const onChange = vi.fn()
    render(<Harness initial={normalizeAgentSettings({ uiTheme: 'pixel' })} onChange={onChange} />, {
      wrapper: EndpointOverviewProvider,
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Background Twinkle' }))
    fireEvent.click(backgroundStyle('Minimal'))
    fireEvent.click(screen.getByRole('switch', { name: 'Node Closing Effect' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Agent Working Effect' }))
    fireEvent.click(screen.getByTestId('settings-ui-theme-mode-light'))
    expect(screen.getByRole('switch', { name: 'Node Creation Effect' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Node Closing Effect' })).not.toBeChecked()
    expect(backgroundStyle('Minimal')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Background Twinkle' })).toBeDisabled()
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uiTheme: 'light',
        canvasBackgroundStyle: 'minimal',
        canvasBackgroundTwinkleEnabled: false,
        nodeCreationPixelEffectEnabled: true,
        nodeClosePixelEffectEnabled: false,
        agentWorkingPixelEffectEnabled: false,
      }),
    )
    fireEvent.click(screen.getByTestId('settings-ui-theme-mode-dark'))
    expect(screen.getByRole('switch', { name: 'Node Creation Effect' })).toBeChecked()
    expect(backgroundStyle('Minimal')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Node Closing Effect' })).not.toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ uiTheme: 'dark' }))
  })

  it('provides localized labels and explains each background style', async () => {
    await applyUiLanguage('zh-CN')
    render(<Harness initial={normalizeAgentSettings({ uiTheme: 'dark' })} />, {
      wrapper: EndpointOverviewProvider,
    })
    expect(screen.getByRole('switch', { name: '创建效果' })).toBeVisible()
    expect(screen.getByRole('switch', { name: '关闭效果' })).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Agent 工作效果' })).toBeVisible()
    expect(screen.getByRole('switch', { name: '背景闪烁' })).toBeVisible()
    const group = screen.getByRole('radiogroup', { name: '背景' })
    for (const name of ['像素', '简约', '关闭']) {
      expect(within(group).getByRole('radio', { name })).toBeVisible()
    }
    expect(screen.getByText('普通点阵，没有背景效果。')).toBeVisible()
    fireEvent.click(within(group).getByRole('radio', { name: '像素' }))
    expect(screen.getByText(/一面玻璃像素墙/)).toBeVisible()
  })
})
