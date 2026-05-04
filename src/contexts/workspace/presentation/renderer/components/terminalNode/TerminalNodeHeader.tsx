import { useCallback, useState, type JSX, type PointerEvent } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import { Copy, LoaderCircle } from 'lucide-react'
import type { AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import { TerminalNodeAgentSessionActions } from './TerminalNodeAgentSessionActions'
import { getStatusClassName } from './status'
import { InlineNodeTitleEditor } from '../shared/InlineNodeTitleEditor'

interface TerminalNodeHeaderProps {
  title: string
  fixedTitlePrefix?: string | null
  kind: WorkspaceNodeKind
  status: AgentRuntimeStatus | null
  labelColor?: LabelColor | null
  agentExecutionDirectory?: string | null
  agentResumeSessionId?: string | null
  agentResumeSessionIdVerified?: boolean
  directoryMismatch?: { executionDirectory: string; expectedDirectory: string } | null
  onHeaderPointerDownCapture?: (event: PointerEvent<HTMLDivElement>) => void
  onTitleCommit?: (title: string) => void
  onClose: () => void
  onCopyLastMessage?: () => Promise<void>
  onReloadSession?: () => Promise<void>
  onListSessions?: (limit?: number) => Promise<AgentSessionSummary[]>
  onSwitchSession?: (summary: AgentSessionSummary) => Promise<void>
}

export function TerminalNodeHeader({
  title,
  fixedTitlePrefix = null,
  kind,
  status,
  labelColor,
  agentExecutionDirectory,
  agentResumeSessionId,
  agentResumeSessionIdVerified = false,
  directoryMismatch,
  onHeaderPointerDownCapture,
  onTitleCommit,
  onClose,
  onCopyLastMessage,
  onReloadSession,
  onListSessions,
  onSwitchSession,
}: TerminalNodeHeaderProps): JSX.Element {
  const { t } = useTranslation()
  const [isCopyingLastMessage, setIsCopyingLastMessage] = useState(false)

  const isTitleEditable =
    (kind === 'terminal' || kind === 'agent') && typeof onTitleCommit === 'function'
  const isAgentNode = kind === 'agent'
  const editableTitle = extractEditableTitle(title, fixedTitlePrefix)
  const shouldRenderCopyLastMessageButton =
    isAgentNode &&
    (status === 'standby' || status === 'running') &&
    typeof onCopyLastMessage === 'function'
  const isCopyLastMessageDisabled = isCopyingLastMessage || status !== 'standby'

  const commitTitleEdit = useCallback(
    (nextEditableTitle: string) => {
      if (!isTitleEditable) {
        return
      }

      const normalizedTitle = nextEditableTitle.trim()
      const nextTitle =
        fixedTitlePrefix && normalizedTitle.length > 0
          ? combineEditableTitle(normalizedTitle, fixedTitlePrefix)
          : normalizedTitle
      onTitleCommit?.(nextTitle)
    },
    [fixedTitlePrefix, isTitleEditable, onTitleCommit],
  )

  const statusLabel = (() => {
    switch (status) {
      case 'standby':
        return t('agentRuntime.standby')
      case 'exited':
        return t('agentRuntime.exited')
      case 'failed':
        return t('agentRuntime.failed')
      case 'stopped':
        return t('agentRuntime.stopped')
      case 'restoring':
        return t('agentRuntime.restoring')
      case 'running':
      default:
        return t('agentRuntime.working')
    }
  })()

  return (
    <div
      className="terminal-node__header"
      data-node-drag-handle="true"
      onPointerDownCapture={onHeaderPointerDownCapture}
    >
      {labelColor ? (
        <span
          className="cove-label-dot cove-label-dot--solid"
          data-cove-label-color={labelColor}
          aria-hidden="true"
        />
      ) : null}
      {isTitleEditable ? (
        <InlineNodeTitleEditor
          value={editableTitle}
          placeholder={t('terminalNode.untitledTitle')}
          ariaLabel={t('terminalNode.titleInputLabel')}
          classNamePrefix="terminal-node"
          displayTestId="terminal-node-title-display"
          inputTestId="terminal-node-inline-title-input"
          prefix={fixedTitlePrefix}
          onCommit={commitTitleEdit}
        />
      ) : (
        <span className="terminal-node__title">{title}</span>
      )}
      <div
        className="terminal-node__header-drag-surface"
        data-testid="terminal-node-header-drag-surface"
        aria-hidden="true"
      />

      {directoryMismatch || isAgentNode ? (
        <div className="terminal-node__header-badges nodrag">
          {directoryMismatch ? (
            <span
              className="terminal-node__badge terminal-node__badge--warning"
              title={t('terminalNodeHeader.directoryMismatchTitle', {
                executionDirectory: directoryMismatch.executionDirectory,
                expectedDirectory: directoryMismatch.expectedDirectory,
              })}
            >
              {t('terminalNodeHeader.directoryMismatch')}
            </span>
          ) : null}
          {isAgentNode ? (
            <span className={`terminal-node__status ${getStatusClassName(status)}`}>
              {statusLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {isAgentNode ? (
        <TerminalNodeAgentSessionActions
          status={status}
          currentDirectory={agentExecutionDirectory ?? null}
          currentResumeSessionId={agentResumeSessionId ?? null}
          currentResumeSessionIdVerified={agentResumeSessionIdVerified}
          onReloadSession={onReloadSession}
          onListSessions={onListSessions}
          onSwitchSession={onSwitchSession}
        />
      ) : null}

      {shouldRenderCopyLastMessageButton ? (
        <button
          type="button"
          className="terminal-node__action terminal-node__action--icon nodrag"
          data-testid="terminal-node-copy-last-message"
          aria-label={t('terminalNodeHeader.copyLastMessage')}
          title={
            isCopyingLastMessage
              ? t('terminalNodeHeader.copyingLastMessage')
              : t('terminalNodeHeader.copyLastMessage')
          }
          disabled={isCopyLastMessageDisabled}
          onClick={async event => {
            event.stopPropagation()
            if (isCopyLastMessageDisabled || !onCopyLastMessage) {
              return
            }

            setIsCopyingLastMessage(true)

            try {
              await onCopyLastMessage()
            } finally {
              setIsCopyingLastMessage(false)
            }
          }}
        >
          {isCopyingLastMessage ? (
            <LoaderCircle className="terminal-node__action-icon terminal-node__action-icon--spinning" />
          ) : (
            <Copy className="terminal-node__action-icon" />
          )}
        </button>
      ) : null}

      <button
        type="button"
        className="terminal-node__close nodrag"
        onClick={event => {
          event.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </div>
  )
}

function extractEditableTitle(title: string, fixedTitlePrefix: string | null): string {
  if (fixedTitlePrefix && title.startsWith(fixedTitlePrefix)) {
    return title.slice(fixedTitlePrefix.length)
  }

  if (fixedTitlePrefix && title.trim() === fixedTitlePrefix.trim()) {
    return ''
  }

  return title
}

function combineEditableTitle(title: string, fixedTitlePrefix: string | null): string {
  return fixedTitlePrefix ? `${fixedTitlePrefix}${title}` : title
}
