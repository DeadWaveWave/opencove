import React, { StrictMode, useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoveSelect } from '../../../src/app/renderer/components/CoveSelect'
import { useSettingsPanelDialog } from '../../../src/contexts/settings/presentation/renderer/useSettingsPanelDialog'

function DialogHarness({ withSelect = false }: { withSelect?: boolean }): React.JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null)
  useSettingsPanelDialog(panelRef)

  return (
    <section ref={panelRef} data-testid="dialog-panel" tabIndex={-1}>
      <button type="button" autoFocus>
        First setting
      </button>
      {withSelect ? (
        <CoveSelect
          value="system"
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
          ]}
          ariaLabel="Theme"
          testId="dialog-theme"
          onChange={() => undefined}
        />
      ) : null}
      <button type="button">Last setting</button>
    </section>
  )
}

function appendBackground(): {
  appShell: HTMLDivElement
  settingsTrigger: HTMLButtonElement
  temporaryTrigger: HTMLButtonElement
  outsideButton: HTMLButtonElement
} {
  const appShell = document.createElement('div')
  appShell.className = 'app-shell'

  const settingsTrigger = document.createElement('button')
  settingsTrigger.dataset.testid = 'app-header-settings'
  settingsTrigger.textContent = 'Settings'
  appShell.append(settingsTrigger)

  const temporaryTrigger = document.createElement('button')
  temporaryTrigger.textContent = 'Temporary settings shortcut'
  appShell.append(temporaryTrigger)

  const outsideButton = document.createElement('button')
  outsideButton.textContent = 'Outside action'

  document.body.append(appShell, outsideButton)
  return { appShell, settingsTrigger, temporaryTrigger, outsideButton }
}

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('useSettingsPanelDialog', () => {
  it('makes only the background app shell inert while mounted', () => {
    const { appShell, settingsTrigger, outsideButton } = appendBackground()
    settingsTrigger.focus()

    const modal = render(<DialogHarness />)

    expect(appShell).toHaveAttribute('inert')
    expect(outsideButton).not.toHaveAttribute('inert')

    modal.unmount()
    expect(appShell).not.toHaveAttribute('inert')
  })

  it('pulls focus from an unrelated external element back to the last panel control', () => {
    const { settingsTrigger, outsideButton } = appendBackground()
    settingsTrigger.focus()
    render(<DialogHarness />)
    const lastSetting = screen.getByRole('button', { name: 'Last setting' })
    lastSetting.focus()

    outsideButton.focus()

    expect(lastSetting).toHaveFocus()
  })

  it('wraps Shift+Tab and Tab at the panel boundary', () => {
    const { settingsTrigger } = appendBackground()
    settingsTrigger.focus()
    render(<DialogHarness />)
    const firstSetting = screen.getByRole('button', { name: 'First setting' })
    const lastSetting = screen.getByRole('button', { name: 'Last setting' })

    firstSetting.focus()
    const backwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    firstSetting.dispatchEvent(backwardTab)

    expect(backwardTab.defaultPrevented).toBe(true)
    expect(lastSetting).toHaveFocus()

    const forwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    lastSetting.dispatchEvent(forwardTab)

    expect(forwardTab.defaultPrevented).toBe(true)
    expect(firstSetting).toHaveFocus()
  })

  it('falls back to the header settings trigger when the opening control was removed', () => {
    vi.useFakeTimers()
    const { settingsTrigger, temporaryTrigger } = appendBackground()
    temporaryTrigger.focus()
    const modal = render(<DialogHarness />)
    temporaryTrigger.remove()

    modal.unmount()
    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(settingsTrigger).toHaveFocus()
  })

  it('does not let StrictMode effect cleanup steal focus from the mounted panel', () => {
    vi.useFakeTimers()
    const { settingsTrigger } = appendBackground()
    settingsTrigger.focus()

    render(
      <StrictMode>
        <DialogHarness />
      </StrictMode>,
    )
    const firstSetting = screen.getByRole('button', { name: 'First setting' })

    expect(firstSetting).toHaveFocus()
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(firstSetting).toHaveFocus()
  })

  it('allows focus in a CoveSelect body portal and a nested cove window', () => {
    const { settingsTrigger } = appendBackground()
    settingsTrigger.focus()
    render(<DialogHarness withSelect />)

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    const portalOption = screen.getByRole('option', { name: 'System' })
    expect(portalOption.closest('.cove-select__menu')?.parentElement).toBe(document.body)
    portalOption.focus()
    expect(portalOption).toHaveFocus()

    const nestedWindow = document.createElement('div')
    nestedWindow.className = 'cove-window'
    const nestedWindowControl = document.createElement('button')
    nestedWindowControl.textContent = 'Nested dialog action'
    nestedWindow.append(nestedWindowControl)
    document.body.append(nestedWindow)

    nestedWindowControl.focus()
    expect(nestedWindowControl).toHaveFocus()
  })
})
