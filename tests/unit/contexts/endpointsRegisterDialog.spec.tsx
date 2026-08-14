import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { EndpointRemoveDialog } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/EndpointRemoveDialog'
import { EndpointsRegisterDialog } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/EndpointsRegisterDialog'

function renderRegisterDialog(
  overrides: Partial<React.ComponentProps<typeof EndpointsRegisterDialog>> = {},
) {
  const onCancel = vi.fn()
  render(
    <EndpointsRegisterDialog
      isOpen
      mode="create"
      error={null}
      isBusy={false}
      isDirty={false}
      registerMode="managed"
      displayName=""
      managedHost=""
      managedUsername=""
      managedPort=""
      managedRemotePort=""
      manualHostname=""
      manualPort=""
      manualToken=""
      canSubmit={false}
      managedPortInvalid={false}
      managedRemotePortInvalid={false}
      onChangeRegisterMode={vi.fn()}
      onChangeDisplayName={vi.fn()}
      onChangeManagedHost={vi.fn()}
      onChangeManagedUsername={vi.fn()}
      onChangeManagedPort={vi.fn()}
      onChangeManagedRemotePort={vi.fn()}
      onChangeManualHostname={vi.fn()}
      onChangeManualPort={vi.fn()}
      onChangeManualToken={vi.fn()}
      onCancel={onCancel}
      onSubmit={vi.fn()}
      {...overrides}
    />,
  )
  return { onCancel }
}

describe('EndpointsRegisterDialog', () => {
  afterEach(async () => {
    await applyUiLanguage('en')
    vi.restoreAllMocks()
  })

  it('keeps managed advanced fields collapsed for a new empty draft', () => {
    renderRegisterDialog()

    expect(screen.getByTestId('settings-endpoints-register-advanced')).not.toHaveAttribute('open')
  })

  it('expands managed advanced fields when editing existing advanced values', () => {
    renderRegisterDialog({
      mode: 'edit',
      managedPort: '22',
      managedRemotePort: '39291',
      canSubmit: true,
    })

    expect(screen.getByTestId('settings-endpoints-register-advanced')).toHaveAttribute('open')
    expect(screen.getByTestId('settings-endpoints-register-remote-port')).toHaveValue('39291')
  })

  it('keeps a dirty form open after pointer-down outside', () => {
    const { onCancel } = renderRegisterDialog({ isDirty: true })

    fireEvent.pointerDown(screen.getByTestId('settings-endpoints-register-backdrop'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closes a dirty form on Escape', () => {
    const { onCancel } = renderRegisterDialog({ isDirty: true })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('closes a clean form after pointer-down outside', () => {
    const { onCancel } = renderRegisterDialog()

    fireEvent.pointerDown(screen.getByTestId('settings-endpoints-register-backdrop'))

    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('EndpointRemoveDialog', () => {
  it('does not dismiss an alert dialog after pointer-down outside', () => {
    const onCancel = vi.fn()
    render(
      <EndpointRemoveDialog
        displayName="Build box"
        mountCount={1}
        isBusy={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.pointerDown(screen.getByTestId('settings-endpoints-remove-backdrop'))

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeVisible()
  })
})
