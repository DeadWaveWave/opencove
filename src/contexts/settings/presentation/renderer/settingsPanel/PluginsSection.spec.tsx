import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { createSettingsPanelUpdaters } from '../useSettingsPanelUpdaters'
import { PluginsSection } from './PluginsSection'
import { getPluginDetail } from '@contexts/plugins/presentation/renderer/pluginDetails'
import { PluginContributionControls } from './PluginContributionControls'
import { getBuiltinPluginManifest } from '@contexts/plugins/application/builtinPlugins'

vi.mock('@contexts/plugins/presentation/renderer/PluginNodePreview', () => ({
  PluginNodePreview: ({ pluginId }: { pluginId: string }) => (
    <div data-testid="plugin-node-preview">{pluginId}</div>
  ),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  void applyUiLanguage('en')
})

describe('PluginsSection', () => {
  it.each([
    ['en', 'Enable Git Board', 'Built-in'],
    ['zh-CN', '启用 Git Board', '内置'],
  ] as const)(
    'shows installed registry metadata and updates settings in %s',
    async (language, label, source) => {
      await applyUiLanguage(language)
      const onChange = vi.fn()
      const settings = { ...DEFAULT_AGENT_SETTINGS, disabledPluginIds: ['another-plugin'] }
      const { updatePluginEnabled } = createSettingsPanelUpdaters({ settings, onChange })
      render(
        <PluginsSection
          settings={settings}
          onChangePluginEnabled={updatePluginEnabled}
          onChangePluginContributionEnabled={vi.fn()}
        />,
      )
      expect(screen.getByRole('heading', { name: 'Git Board', level: 4 })).toBeVisible()
      expect(screen.getByText('0.1.0')).toBeVisible()
      expect(screen.getByText(source)).toBeVisible()
      const toggle = screen.getByRole('checkbox', { name: label })
      expect(toggle).toBeChecked()
      fireEvent.click(toggle)
      expect(screen.queryByTestId('settings-plugin-detail-git-board')).toBeNull()
      expect(onChange).toHaveBeenCalledWith({
        ...settings,
        disabledPluginIds: ['another-plugin', 'git-board'],
      })
    },
  )

  it('shows a disabled plugin without removing its registry entry', async () => {
    await applyUiLanguage('en')
    const onChangePluginEnabled = vi.fn()
    render(
      <PluginsSection
        settings={{ disabledPluginIds: ['git-board'], pluginContributions: {} }}
        onChangePluginEnabled={onChangePluginEnabled}
        onChangePluginContributionEnabled={vi.fn()}
      />,
    )
    expect(screen.getByText('Disabled')).toBeVisible()
    const toggle = screen.getByRole('checkbox', { name: 'Enable Git Board' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(onChangePluginEnabled).toHaveBeenCalledWith('git-board', true)
  })

  it.each([
    ['en', 'View Git Board details', 'All plugins', 'Your repository, beside your work'],
    ['zh-CN', '查看 Git Board 详情', '全部插件', '把仓库放在工作旁边'],
  ] as const)(
    'opens documentation and preview in %s, then restores list focus and scroll',
    async (language, openLabel, backLabel, documentTitle) => {
      await applyUiLanguage(language)
      const onChangePluginEnabled = vi.fn()
      const { container } = render(
        <div className="settings-panel__content">
          <PluginsSection
            settings={{ disabledPluginIds: ['git-board'], pluginContributions: {} }}
            onChangePluginEnabled={onChangePluginEnabled}
            onChangePluginContributionEnabled={vi.fn()}
          />
        </div>,
      )
      const scroller = container.firstElementChild as HTMLElement
      scroller.scrollTop = 128
      fireEvent.click(screen.getByRole('button', { name: openLabel }))
      expect(screen.getByTestId('settings-plugin-detail-git-board')).toBeVisible()
      expect(screen.getByRole('heading', { name: 'Git Board', level: 3 })).toHaveFocus()
      expect(scroller.scrollTop).toBe(0)
      expect(screen.getByTestId('plugin-node-preview')).toBeVisible()
      expect(screen.getByRole('heading', { name: documentTitle })).toBeVisible()
      expect(screen.getByTestId('plugin-readme').querySelector('img')?.getAttribute('src')).toBe(
        getPluginDetail('git-board', language)?.assets['./overview.svg'],
      )
      expect(screen.getByTestId('settings-plugin-enabled-git-board')).not.toBeChecked()
      expect(onChangePluginEnabled).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('settings-plugin-enabled-git-board'))
      expect(onChangePluginEnabled).toHaveBeenCalledWith('git-board', true)
      fireEvent.click(screen.getByRole('button', { name: backLabel }))
      expect(screen.getByRole('button', { name: openLabel })).toHaveFocus()
      expect(scroller.scrollTop).toBe(128)
      expect(screen.queryByTestId('plugin-node-preview')).toBeNull()
    },
  )

  it('copies the actual CLI guide command and reports clipboard failures', async () => {
    await applyUiLanguage('en')
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('opencoveApi', { clipboard: { writeText } })
    render(
      <PluginsSection
        settings={{ disabledPluginIds: [], pluginContributions: {} }}
        onChangePluginEnabled={vi.fn()}
        onChangePluginContributionEnabled={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy guide command' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Command copied'))
    expect(writeText).toHaveBeenCalledWith('opencove plugin guide')
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy guide command' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy'))
  })

  it.each([
    ['en', 'Show in action bar', 'Show in right-click menu'],
    ['zh-CN', '在操作栏中显示', '在右键菜单中显示'],
  ] as const)(
    'configures independent creation entries while the plugin is disabled in %s',
    async (language, actionBarLabel, contextMenuLabel) => {
      await applyUiLanguage(language)
      const settings = {
        ...DEFAULT_AGENT_SETTINGS,
        disabledPluginIds: ['git-board'],
        pluginContributions: { 'other-plugin': { actionBar: false } },
      }
      const onChange = vi.fn()
      const { updatePluginEnabled, updatePluginContributionEnabled } = createSettingsPanelUpdaters({
        settings,
        onChange,
      })
      render(
        <PluginsSection
          settings={settings}
          onChangePluginEnabled={updatePluginEnabled}
          onChangePluginContributionEnabled={updatePluginContributionEnabled}
        />,
      )
      fireEvent.click(screen.getByTestId('settings-plugin-details-git-board'))
      const actionBar = screen.getByRole('switch', { name: actionBarLabel })
      const contextMenu = screen.getByRole('switch', { name: contextMenuLabel })
      expect(actionBar).toBeChecked()
      expect(contextMenu).toBeChecked()
      expect(actionBar).toBeEnabled()
      expect(contextMenu).toBeEnabled()
      fireEvent.click(actionBar)
      expect(onChange).toHaveBeenLastCalledWith({
        ...settings,
        pluginContributions: { ...settings.pluginContributions, 'git-board': { actionBar: false } },
      })
      expect(screen.getByTestId('settings-plugin-enabled-git-board')).not.toBeChecked()
      expect(contextMenu).toBeChecked()
      expect(screen.getByTestId('plugin-node-preview')).toBeVisible()
    },
  )

  it('shows only contributions declared by the plugin manifest and restores saved preferences', async () => {
    await applyUiLanguage('en')
    const plugin = getBuiltinPluginManifest('git-board')!
    const onChange = vi.fn()
    const settings = { pluginContributions: { 'git-board': { actionBar: false } } }
    const { rerender } = render(
      <PluginContributionControls
        plugin={{ ...plugin, contextMenu: false }}
        settings={settings}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('switch', { name: 'Show in action bar' })).not.toBeChecked()
    expect(screen.queryByRole('switch', { name: 'Show in right-click menu' })).toBeNull()
    rerender(
      <PluginContributionControls
        plugin={{ ...plugin, actionBar: false, contextMenu: false }}
        settings={settings}
        onChange={onChange}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Show in' })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets the whole location tile and its description toggle the same accessible switch', async () => {
    await applyUiLanguage('en')
    const plugin = getBuiltinPluginManifest('git-board')!
    const onChange = vi.fn()
    render(
      <PluginContributionControls
        plugin={plugin}
        settings={{ pluginContributions: {} }}
        onChange={onChange}
      />,
    )
    const tile = screen.getByTestId('settings-plugin-contribution-tile-actionBar-git-board')
    const input = screen.getByTestId('settings-plugin-contribution-actionBar-git-board')
    expect(tile.tagName).toBe('LABEL')
    expect(input).toHaveRole('switch')
    expect(input).toHaveAccessibleDescription('On the right side of the canvas')
    fireEvent.click(tile)
    expect(onChange).toHaveBeenLastCalledWith('actionBar', false)
    fireEvent.click(screen.getByText('In the menu on an empty canvas area'))
    expect(onChange).toHaveBeenLastCalledWith('contextMenu', false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
