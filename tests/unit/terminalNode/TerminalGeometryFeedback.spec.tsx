import { act, fireEvent, render, screen } from '@testing-library/react'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { TerminalGeometryFeedback } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalGeometryFeedback'
import {
  beginTerminalGeometryCommit,
  getTerminalGeometryCommitRequest,
  markTerminalGeometryCommitFailed,
  markTerminalGeometryCommitSettled,
  recordTerminalGeometryCommitResult,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'

describe('terminal size failure feedback', () => {
  afterEach(async () => {
    await applyUiLanguage('en')
  })
  it.each([
    ['en', 'Retry sizing'],
    ['zh-CN', '重新适配'],
  ] as const)(
    'shows an actionable failure and clears it after confirmation in %s',
    async (language, retryLabel) => {
      await applyUiLanguage(language)
      const terminal = {} as never
      const onRetry = vi.fn()
      render(<TerminalGeometryFeedback terminal={terminal} onRetry={onRetry} />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      act(() => markTerminalGeometryCommitFailed(terminal, beginTerminalGeometryCommit(terminal)))
      expect(screen.getByRole('status')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: retryLabel }))
      expect(onRetry).toHaveBeenCalledOnce()
      act(() => {
        const revision = beginTerminalGeometryCommit(terminal)
        const request = getTerminalGeometryCommitRequest(terminal, revision)!
        recordTerminalGeometryCommitResult(terminal, revision, {
          sessionId: 'session',
          operationId: request.operationId,
          status: 'accepted',
          changed: true,
          geometry: { cols: 80, rows: 24, revision: 1 },
          authority: { role: 'controller', epoch: 1 },
        })
        markTerminalGeometryCommitSettled(terminal, revision)
      })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    },
  )
})
import React from 'react'
