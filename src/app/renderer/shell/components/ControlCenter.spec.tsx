import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { applyUiLanguage } from '@app/renderer/i18n'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
import { examplePlugin } from '@contexts/plugins/presentation/renderer/pluginPresentationTestFixture'
import * as registry from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import * as themeApplication from '@contexts/plugins/presentation/renderer/themeApplication'
import { ControlCenter } from './ControlCenter'

const actions = {
  onChangeUiTheme: vi.fn(),
  onToggleMinimap: vi.fn(),
  onChangeInAppNotifications: vi.fn(),
  onChangeSystemNotifications: vi.fn(),
}

const openSettingsAt = vi.fn()

function Harness({
  hasActiveWorkspace = true,
  uiTheme = 'dark',
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
        hasActiveWorkspace={hasActiveWorkspace}
        inAppNotificationsEnabled
        systemNotificationsEnabled={false}
        settingsShortcut="⌘,"
        onClose={() => setOpen(false)}
        onOpenSettings={pageId => {
          openSettingsAt(pageId)
          setSettingsOpen(true)
        }}
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

describe('Control Center surfaces', () => {
  const originalWidth = window.innerWidth

  beforeEach(async () => {
    await applyUiLanguage('en')
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.spyOn(registry, 'usePluginRegistry').mockReturnValue({ plugins: [], error: null })
    vi.spyOn(themeApplication, 'useThemeApplicationStatus').mockReturnValue({
      requestedId: 'dark',
      appliedId: 'dark',
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

  it('keeps desktop nonmodal: an appearance, three quick switches and two lines into Settings', () => {
    render(<Harness hasActiveWorkspace={false} />)
    openControls()
    const surface = screen.getByRole('dialog', { name: 'Control Center' })
    expect(surface.getAttribute('aria-modal')).toBeNull()
    expect(surface).toHaveClass('cove-pixel-window')

    // Focus enters on the checked appearance.
    const dark = screen.getByRole('radio', { name: 'Dark' })
    expect(dark).toBeChecked()
    expect(document.activeElement).toBe(dark)
    fireEvent.click(screen.getByRole('radio', { name: 'Follow System' }))
    expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('system')

    // Only Cove's own appearances are offered; the look's finer choices live in Settings.
    expect(screen.getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual([
      'light',
      'dark',
      'system',
    ])
    expect(screen.queryByRole('switch')).toBeNull()

    const minimap = screen.getByRole('button', { name: 'Minimap' })
    expect(minimap).toBeDisabled()
    expect(minimap).toHaveAccessibleDescription('Open a workspace to show its minimap.')
    const inApp = screen.getByRole('button', { name: 'In-app alerts' })
    const system = screen.getByRole('button', { name: 'System alerts' })
    expect(inApp).toHaveAttribute('aria-pressed', 'true')
    expect(system).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(inApp)
    expect(actions.onChangeInAppNotifications).toHaveBeenCalledWith(false)
    fireEvent.click(system)
    expect(actions.onChangeSystemNotifications).toHaveBeenCalledWith(true)
    expect(actions.onToggleMinimap).not.toHaveBeenCalled()

    expect(screen.getByTestId('control-center-open-settings').textContent).toContain('⌘,')

    const outside = screen.getByRole('button', { name: 'Outside action' })
    outside.focus()
    expect(document.activeElement).toBe(outside)
  })

  it('toggles the minimap from its tile while a workspace is open', () => {
    render(<Harness />)
    openControls()
    const minimap = screen.getByRole('button', { name: 'Minimap' })
    expect(minimap).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(minimap)
    expect(actions.onToggleMinimap).toHaveBeenCalledTimes(1)
  })

  it.each(['en', 'zh-CN'] as const)(
    'names an active plugin theme and checks no appearance in %s',
    async language => {
      await applyUiLanguage(language)
      vi.mocked(registry.usePluginRegistry).mockReturnValue({
        plugins: [themedPlugin],
        error: null,
      })
      render(<Harness uiTheme="plugin:example-tool:night" />)
      openControls()
      expect(screen.getByTestId('control-center-current-theme').textContent).toContain(
        'Prism Night',
      )
      const appearances = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(appearances.every(radio => !radio.checked)).toBe(true)
      // Focus still enters the group, on its first appearance.
      expect(document.activeElement).toBe(screen.getByTestId('control-center-theme-mode-light'))
      fireEvent.click(screen.getByTestId('control-center-theme-mode-dark'))
      expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('dark')
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
    expect(screen.getByRole('status').textContent).toContain('unavailable')
    expect(screen.queryByTestId('control-center-current-theme')).toBeNull()
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
    vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [plugin], error: null })
    rerender(<Harness uiTheme="plugin:example-tool:night" />)
    expect(screen.getByTestId('control-center-current-theme').textContent).toContain('Prism Night')
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
      appliedId: 'dark',
      loading: false,
      error: 'Missing stylesheet',
    })
    render(<Harness uiTheme="plugin:example-tool:night" />)
    openControls()
    expect(screen.getByRole('status').textContent).toContain('could not be loaded')
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
  })

  it('constrains mobile focus and restores the trigger after closing the sheet', () => {
    setViewportWidth(360)
    render(<Harness />)
    const trigger = openControls()
    const surface = screen.getByRole('dialog', { name: 'Control Center' })
    const dark = screen.getByRole('radio', { name: 'Dark' })
    expect(surface.getAttribute('aria-modal')).toBe('true')
    expect(surface).toHaveClass('control-center--sheet', 'cove-pixel-window')
    expect(screen.getByTestId('app-shell').inert).toBe(true)
    expect(document.activeElement).toBe(dark)
    screen.getByRole('button', { name: 'Outside action' }).focus()
    expect(document.activeElement).toBe(dark)
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

  it.each([
    [360, 'control-center-open-settings', null],
    [1200, 'control-center-open-settings', null],
    [1200, 'control-center-open-notification-settings', 'notifications'],
  ] as const)(
    'hands focus to Settings at %i px from %s without delayed restoration',
    (width, testId, pageId) => {
      setViewportWidth(width)
      render(<Harness />)
      const trigger = openControls()
      fireEvent.click(screen.getByTestId(testId))
      expect(openSettingsAt).toHaveBeenCalledWith(pageId)
      expect(screen.queryByTestId('control-center')).toBeNull()
      const search = screen.getByRole('textbox', { name: 'Search settings' })
      expect(document.activeElement).toBe(search)
      act(() => vi.runOnlyPendingTimers())
      expect(document.activeElement).toBe(search)
      expect(document.activeElement).not.toBe(trigger)
    },
  )

  it('releases the mobile input lock and preserves settings when resizing to desktop', () => {
    setViewportWidth(360)
    render(<Harness />)
    openControls()
    expect(screen.getByTestId('app-shell').inert).toBe(true)
    setViewportWidth(1200)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.getByTestId('app-shell').inert).toBe(false)
    expect(screen.getByTestId('control-center').getAttribute('aria-modal')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Dark' }))
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
    expect(actions.onToggleMinimap).not.toHaveBeenCalled()
  })
})
