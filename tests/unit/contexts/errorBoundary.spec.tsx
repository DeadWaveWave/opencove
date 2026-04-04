import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { ErrorBoundary } from '../../../src/app/renderer/components/ErrorBoundary'

function ThrowOnRender(): never {
  throw new Error('renderer exploded')
}

describe('ErrorBoundary', () => {
  const logRuntimeDiagnostics = vi.fn()

  beforeEach(() => {
    window.opencoveApi = {
      debug: {
        logRuntimeDiagnostics,
      },
    } as typeof window.opencoveApi
  })

  afterEach(async () => {
    await applyUiLanguage('en')
    logRuntimeDiagnostics.mockReset()
    vi.restoreAllMocks()
  })

  it('renders a recovery fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(
      screen.getByText('The renderer hit an unrecoverable error. Your workspace data is safe.'),
    ).toBeInTheDocument()
    expect(screen.getByText('renderer exploded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(logRuntimeDiagnostics).toHaveBeenCalledWith({
      source: 'renderer-error-boundary',
      level: 'error',
      event: 'component-did-catch',
      message: 'Renderer error boundary caught an uncaught error.',
      details: expect.objectContaining({
        errorName: 'Error',
        errorMessage: 'renderer exploded',
        componentStack: expect.any(String),
      }),
    })
  })

  it('uses the active UI language for fallback copy', async () => {
    await applyUiLanguage('zh-CN')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: '出现异常' })).toBeInTheDocument()
    expect(
      screen.getByText('渲染进程遇到了不可恢复的错误。你的工作区数据仍然安全。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '忽略' })).toBeInTheDocument()
  })
})
