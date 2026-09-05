import React, { useCallback, useSyncExternalStore } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useTranslation } from '@app/renderer/i18n'
import {
  hasTerminalGeometryCommitFailed,
  subscribeTerminalGeometryWriteGate,
} from './terminalGeometryCoordinator'

export function TerminalGeometryFeedback({
  terminal,
  onRetry,
}: {
  terminal: Terminal | null
  onRetry: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminal ? subscribeTerminalGeometryWriteGate(terminal, listener) : () => undefined,
    [terminal],
  )
  const getSnapshot = useCallback(
    () => (terminal ? hasTerminalGeometryCommitFailed(terminal) : false),
    [terminal],
  )
  const failed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!failed) {
    return null
  }
  return (
    <div
      className="terminal-node__recovery-issue terminal-node__geometry-feedback nodrag"
      role="status"
      data-testid="terminal-geometry-feedback"
    >
      <span>{t('terminalNode.geometrySyncFailed')}</span>
      <button type="button" className="terminal-node__recovery-issue-action" onClick={onRetry}>
        {t('terminalNode.retryGeometrySync')}
      </button>
    </div>
  )
}
