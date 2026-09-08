import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

describe('independent Pixel effect controls in Appearance', () => {
  it.each(['dark', 'light', 'system', 'pixel', 'pixel-light'])(
    'exposes all three controls for the %s theme',
    uiTheme => {
      render(<Harness initial={normalizeAgentSettings({ uiTheme })} />, {
        wrapper: EndpointOverviewProvider,
      })
      for (const label of [
        'Node Creation Pixels',
        'Node Closing Pixels',
        'Canvas Pixel Background',
      ]) {
        const control = screen.getByRole('checkbox', { name: label })
        expect(control).toBeEnabled()
        expect(control).toHaveProperty('checked', uiTheme === 'pixel' || uiTheme === 'pixel-light')
      }
    },
  )

  it('updates only the selected flags and retains choices when the theme changes', () => {
    const onChange = vi.fn()
    render(<Harness initial={normalizeAgentSettings({ uiTheme: 'pixel' })} onChange={onChange} />, {
      wrapper: EndpointOverviewProvider,
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Canvas Pixel Background' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Node Closing Pixels' }))
    fireEvent.click(screen.getByTestId('settings-ui-theme-light'))
    expect(screen.getByRole('checkbox', { name: 'Node Creation Pixels' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Node Closing Pixels' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Canvas Pixel Background' })).not.toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uiTheme: 'light',
        canvasPixelBackgroundEnabled: false,
        nodeCreationPixelEffectEnabled: true,
        nodeClosePixelEffectEnabled: false,
      }),
    )
    fireEvent.click(screen.getByTestId('settings-ui-theme-pixel-light'))
    expect(screen.getByRole('checkbox', { name: 'Node Creation Pixels' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Node Closing Pixels' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Canvas Pixel Background' })).not.toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ uiTheme: 'pixel-light' }))
  })

  it('provides localized labels and explains the standard-grid fallback', async () => {
    await applyUiLanguage('zh-CN')
    render(<Harness initial={normalizeAgentSettings({ uiTheme: 'dark' })} />, {
      wrapper: EndpointOverviewProvider,
    })
    expect(screen.getByRole('checkbox', { name: '创建像素效果' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: '关闭像素效果' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: '画布点阵背景' })).toBeVisible()
    expect(screen.getByText(/关闭后显示标准画布网格/)).toBeVisible()
  })
})
