import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../src/app/renderer/i18n'
import { AppShellBootBoundary } from '../../../src/app/renderer/shell/components/AppShellBootBoundary'

describe('AppShellBootBoundary', () => {
  it('shows the startup loading state until boot is ready', () => {
    render(
      <I18nProvider>
        <AppShellBootBoundary isBootReady={false}>
          <div data-testid="boot-ready-child">ready</div>
        </AppShellBootBoundary>
      </I18nProvider>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Opening your workspace')).toBeInTheDocument()
    expect(screen.getByText('Restoring projects, spaces, and terminals…')).toBeInTheDocument()
    expect(screen.queryByTestId('boot-ready-child')).not.toBeInTheDocument()
  })

  it('renders the shell content once boot is ready', () => {
    render(
      <I18nProvider>
        <AppShellBootBoundary isBootReady>
          <div data-testid="boot-ready-child">ready</div>
        </AppShellBootBoundary>
      </I18nProvider>,
    )

    expect(screen.getByTestId('boot-ready-child')).toHaveTextContent('ready')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
