import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { applyUiLanguage } from '@app/renderer/i18n'
import { UI_THEMES } from '@contexts/settings/domain/agentSettings'
import { ControlCenter } from './ControlCenter'

const actions = {
  onChangeUiTheme: vi.fn(),
  onToggleMinimap: vi.fn(),
  onToggleStandbyBanner: vi.fn(),
}

function Harness({ hasActiveWorkspace = true }: { hasActiveWorkspace?: boolean }) {
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
        uiTheme="pixel"
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
    setViewportWidth(1200)
  })

  afterEach(() => {
    cleanup()
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
