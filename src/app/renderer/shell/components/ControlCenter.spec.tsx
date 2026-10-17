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
  onChangePixelBackground: vi.fn(),
  onChangeMotionSignals: vi.fn(),
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
        isPixelBackgroundEnabled
        areMotionSignalsEnabled={false}
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

  it('keeps desktop nonmodal and offers theme family, mode and display switches', () => {
    render(<Harness hasActiveWorkspace={false} uiTheme="dark" />)
    openControls()
    const surface = screen.getByRole('dialog', { name: 'Control Center' })
    const minimap = screen.getByRole('switch', { name: 'Minimap' }) as HTMLInputElement
    const pixelBackground = screen.getByRole('switch', { name: 'Pixel background' })
    expect(surface.getAttribute('aria-modal')).toBeNull()
    expect(minimap.disabled).toBe(true)
    expect(document.activeElement).toBe(pixelBackground)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).not.toBeNull()
    expect((screen.getByRole('radio', { name: 'Cove' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true)
    // The notification banner lives in Settings now.
    expect(screen.queryByTestId('control-center-toggle-agent-standby-banner')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'Pixel' }))
    expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('pixel')
    fireEvent.click(screen.getByRole('radio', { name: 'Follow System' }))
    expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('system')
    fireEvent.click(pixelBackground)
    expect(actions.onChangePixelBackground).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('switch', { name: 'Motion signals' }))
    expect(actions.onChangeMotionSignals).toHaveBeenCalledWith(true)
    expect(actions.onToggleMinimap).not.toHaveBeenCalled()
    const outside = screen.getByRole('button', { name: 'Outside action' })
    outside.focus()
    expect(document.activeElement).toBe(outside)
  })

  it('offers only the modes the current family has', () => {
    render(<Harness uiTheme="pixel-light" />)
    openControls()
    expect((screen.getByRole('radio', { name: 'Pixel' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('radio', { name: 'Follow System' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Cove' }))
    expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('light')
  })

  it.each(['en', 'zh-CN'] as const)(
    'names an active plugin theme and leaves its mode to Settings in %s',
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
        plugins: [themedPlugin],
        error: null,
      })
      render(<Harness uiTheme="plugin:example-tool:night" />)
      openControls()
      expect(screen.getByTestId('control-center-current-theme').textContent).toBe('Prism Night')
      const families = screen.getAllByRole('radio').slice(0, 2) as HTMLInputElement[]
      expect(families.every(radio => !radio.checked)).toBe(true)
      expect(
        (
          screen
            .getByTestId('control-center-theme-mode')
            .querySelectorAll('input') as NodeListOf<HTMLInputElement>
        )[0]?.disabled,
      ).toBe(true)
      document.documentElement.dataset.coveTheme = 'dark'
      fireEvent.click(families[0]!)
      expect(actions.onChangeUiTheme).toHaveBeenLastCalledWith('dark')
      delete document.documentElement.dataset.coveTheme
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
    expect(screen.getByTestId('control-center-current-theme').textContent).toBe('Prism Night')
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
    const pixelBackground = screen.getByRole('switch', { name: 'Pixel background' })
    expect(surface.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByTestId('app-shell').inert).toBe(true)
    expect(document.activeElement).toBe(pixelBackground)
    screen.getByRole('button', { name: 'Outside action' }).focus()
    expect(document.activeElement).toBe(pixelBackground)
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
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'Pixel background' }))
    expect(actions.onChangeUiTheme).not.toHaveBeenCalled()
    expect(actions.onToggleMinimap).not.toHaveBeenCalled()
    expect(actions.onChangePixelBackground).not.toHaveBeenCalled()
  })
})
