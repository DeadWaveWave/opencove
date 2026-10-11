import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { applyUiLanguage } from '@app/renderer/i18n'
import { UI_THEMES, type UiTheme } from '@contexts/settings/domain/agentSettings'
import { examplePlugin } from '@contexts/plugins/presentation/renderer/pluginPresentationTestFixture'
import * as registry from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import * as themeApplication from '@contexts/plugins/presentation/renderer/themeApplication'
import { ControlCenter } from './ControlCenter'

const actions = {
  onChangeUiTheme: vi.fn(),
  onToggleMinimap: vi.fn(),
  onToggleStandbyBanner: vi.fn(),
}

function Harness({
  hasActiveWorkspace = true,
  uiTheme = 'pixel',
}: {
  hasActiveWorkspace?: boolean
  uiTheme?: UiTheme
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const settingsRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <>
      <div className="app-shell" data-testid="app-shell">
        <button ref={anchorRef} onClick={() => setOpen(true)}>
          Open controls
        </button>
        <button>Outside action</button>
      </div>
      <ControlCenter
        {...actions}
        isOpen={open}
        anchorRef={anchorRef}
        uiTheme={uiTheme}
        isMinimapVisible
        isStandbyBannerEnabled
        hasActiveWorkspace={hasActiveWorkspace}
        onClose={() => setOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Dialog
        open={settingsOpen}
        aria-label="Settings"
        initialFocusRef={settingsRef}
        onDismiss={() => setSettingsOpen(false)}
      >
        <input ref={settingsRef} aria-label="Search settings" />
      </Dialog>
    </>
  )
}

function openControls() {
  const trigger = screen.getByRole('button', { name: 'Open controls' })
  trigger.focus()
  fireEvent.click(trigger)
  act(() => vi.runOnlyPendingTimers())
  return trigger
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  act(() => window.dispatchEvent(new Event('resize')))
}

describe('Control Center surfaces', () => {
  const originalWidth = window.innerWidth

  beforeEach(async () => {
    await applyUiLanguage('en')
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.spyOn(registry, 'usePluginRegistry').mockReturnValue({ plugins: [], error: null })
    vi.spyOn(themeApplication, 'useThemeApplicationStatus').mockReturnValue({
      requestedId: 'pixel',
      appliedId: 'pixel',
      loading: false,
      error: null,
    })
    setViewportWidth(1200)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
    setViewportWidth(originalWidth)
  })

  it('keeps desktop nonmodal, exposes all theme choices, and focuses an enabled switch', () => {
    render(<Harness hasActiveWorkspace={false} />)
    openControls()
    const surface = screen.getByRole('dialog', { name: 'Control Center' })
    const minimap = screen.getByRole('switch', { name: 'Minimap' }) as HTMLInputElement
    const banner = screen
      .getByTestId('control-center-toggle-agent-standby-banner')
      .querySelector('input')
    expect(surface.getAttribute('aria-modal')).toBeNull()
    expect(minimap.disabled).toBe(true)
    expect(document.activeElement).toBe(banner)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).not.toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(UI_THEMES.length)
    expect(surface.querySelector('.control-center__row-status')).toBeNull()

    fireEvent.click(screen.getByTestId('control-center-theme-pixel-light'))
    expect(actions.onChangeUiTheme).toHaveBeenCalledWith('pixel-light')
    fireEvent.click(banner!)
    expect(actions.onToggleStandbyBanner).toHaveBeenCalledOnce()
    expect(actions.onToggleMinimap).not.toHaveBeenCalled()
    const outside = screen.getByRole('button', { name: 'Outside action' })
    outside.focus()
    expect(document.activeElement).toBe(outside)
  })

  it.each(['en', 'zh-CN'] as const)(
    'lists available plugin themes with readable names in %s',
    async language => {
      await applyUiLanguage(language)
      const themedPlugin = {
        ...examplePlugin,
        themes: [
          {
            id: 'night',
            title: 'Prism Night',
            appearance: 'dark' as const,
            tokens: { '--cove-accent': '#aabbcc' },
          },
        ],
      }
      vi.mocked(registry.usePluginRegistry).mockReturnValue({
        plugins: [
          themedPlugin,
          { ...themedPlugin, id: 'disabled', enabled: false },
          { ...themedPlugin, id: 'broken', status: 'error' },
        ],
        error: null,
      })
      const { rerender } = render(<Harness uiTheme="plugin:example-tool:night" />)
      openControls()
      expect(screen.getAllByRole('radio')).toHaveLength(UI_THEMES.length + 1)
      const choice = screen.getByRole('radio', {
        name: 'Prism Night Example Tool',
      }) as HTMLInputElement
      expect(choice.checked).toBe(true)
      expect(screen.getByTestId('control-center-current-theme').textContent).toBe('Prism Night')
      rerender(<Harness uiTheme="pixel" />)
      fireEvent.click(choice)
      expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('plugin:example-tool:night')
    },
  )

  it('tracks plugin availability without rewriting the durable theme choice', () => {
    const plugin = {
      ...examplePlugin,
      themes: [{ id: 'night', title: 'Prism Night', appearance: 'dark' as const, tokens: {} }],
    }
    vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [plugin], error: null })
    const { rerender } = render(<Harness uiTheme="plugin:example-tool:night" />)
    openControls()
    vi.mocked(registry.usePluginRegistry).mockReturnValue({
      plugins: [{ ...plugin, enabled: false }],
      error: null,
    })
    rerender(<Harness uiTheme="plugin:example-tool:night" />)
    expect(screen.queryByTestId('control-center-theme-plugin:example-tool:night')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('unavailable')
    expect(screen.getByTestId('control-center-current-theme').textContent).toBe('Pixel')
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
    vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [plugin], error: null })
    rerender(<Harness uiTheme="plugin:example-tool:night" />)
    expect(
      (screen.getByTestId('control-center-theme-plugin:example-tool:night') as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(screen.queryByRole('status')).toBeNull()
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
  })

  it('explains a failed theme application without replacing the saved choice', () => {
    const plugin = {
      ...examplePlugin,
      themes: [{ id: 'night', title: 'Prism Night', appearance: 'dark' as const, tokens: {} }],
    }
    vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [plugin], error: null })
    vi.mocked(themeApplication.useThemeApplicationStatus).mockReturnValue({
      requestedId: 'plugin:example-tool:night',
      appliedId: 'pixel',
      loading: false,
      error: 'Missing stylesheet',
    })
    render(<Harness uiTheme="plugin:example-tool:night" />)
    openControls()
    expect(screen.getByTestId('control-center-current-theme').textContent).toBe('Pixel')
    expect(screen.getByRole('status').textContent).toContain('could not be loaded')
    expect(
      (screen.getByTestId('control-center-theme-plugin:example-tool:night') as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
  })

  it('constrains mobile focus and restores the trigger after closing the sheet', () => {
    setViewportWidth(360)
    render(<Harness />)
    const trigger = openControls()
    const surface = screen.getByRole('dialog', { name: 'Control Center' })
    const minimap = screen.getByRole('switch', { name: 'Minimap' })
    expect(surface.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByTestId('app-shell').inert).toBe(true)
    expect(document.activeElement).toBe(minimap)
    screen.getByRole('button', { name: 'Outside action' }).focus()
    expect(document.activeElement).toBe(minimap)
    const close = screen.getByTestId('control-center-close')
    const settings = screen.getByTestId('control-center-open-settings')
    settings.focus()
    fireEvent.keyDown(settings, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(settings)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByTestId('control-center')).toBeNull()
    expect(screen.getByTestId('app-shell').inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it.each([360, 1200])('hands focus to Settings at %i px without delayed restoration', width => {
    setViewportWidth(width)
    render(<Harness />)
    const trigger = openControls()
    fireEvent.click(screen.getByTestId('control-center-open-settings'))
    expect(screen.queryByTestId('control-center')).toBeNull()
    const search = screen.getByRole('textbox', { name: 'Search settings' })
    expect(document.activeElement).toBe(search)
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(search)
    expect(document.activeElement).not.toBe(trigger)
  })

  it('releases the mobile input lock and preserves settings when resizing to desktop', () => {
    setViewportWidth(360)
    render(<Harness />)
    openControls()
    expect(screen.getByTestId('app-shell').inert).toBe(true)
    setViewportWidth(1200)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.getByTestId('app-shell').inert).toBe(false)
    expect(screen.getByTestId('control-center').getAttribute('aria-modal')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'Minimap' }))
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
    expect(actions.onToggleMinimap).not.toHaveBeenCalled()
    expect(actions.onToggleStandbyBanner).not.toHaveBeenCalled()
  })
})
