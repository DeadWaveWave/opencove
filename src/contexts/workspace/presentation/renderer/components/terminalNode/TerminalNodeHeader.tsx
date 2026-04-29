import React, { useCallback, useEffect, useState, type JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Copy, LoaderCircle } from 'lucide-react'
import type { AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import { getStatusClassName } from './status'

interface TerminalNodeHeaderProps {
  title: string
  fixedTitlePrefix?: string | null
  kind: WorkspaceNodeKind
  status: AgentRuntimeStatus | null
  labelColor?: LabelColor | null
  directoryMismatch?: { executionDirectory: string; expectedDirectory: string } | null
  onTitleCommit?: (title: string) => void
  onClose: () => void
  onCopyLastMessage?: () => Promise<void>
}

export function TerminalNodeHeader({
  title,
  fixedTitlePrefix = null,
  kind,
  status,
  labelColor,
  directoryMismatch,
  onTitleCommit,
  onClose,
  onCopyLastMessage,
}: TerminalNodeHeaderProps): JSX.Element {
  const { t } = useTranslation()
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(() => extractEditableTitle(title, fixedTitlePrefix))
  const [isCopyingLastMessage, setIsCopyingLastMessage] = useState(false)

  const isTitleEditable =
    (kind === 'terminal' || kind === 'agent') && typeof onTitleCommit === 'function'
  const isAgentNode = kind === 'agent'
  const shouldRenderCopyLastMessageButton =
    isAgentNode &&
    (status === 'standby' || status === 'running') &&
    typeof onCopyLastMessage === 'function'
  const isCopyLastMessageDisabled = isCopyingLastMessage || status !== 'standby'

  useEffect(() => {
    if (isTitleEditing) {
      return
    }

    setTitleDraft(extractEditableTitle(title, fixedTitlePrefix))
  }, [fixedTitlePrefix, isTitleEditing, title])

  const commitTitleEdit = useCallback(() => {
    if (!isTitleEditable) {
      return
    }

    const normalizedTitle = titleDraft.trim()
    if (normalizedTitle.length === 0) {
      setTitleDraft(extractEditableTitle(title, fixedTitlePrefix))
      return
    }

    const nextTitle = combineEditableTitle(normalizedTitle, fixedTitlePrefix)

    if (nextTitle !== title) {
      onTitleCommit(nextTitle)
    }
  }, [fixedTitlePrefix, isTitleEditable, onTitleCommit, title, titleDraft])

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(extractEditableTitle(title, fixedTitlePrefix))
  }, [fixedTitlePrefix, title])

  const startTitleEditing = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isTitleEditable || isTitleEditing) {
        return
      }

      if (event.target instanceof Element && event.target.closest('.nodrag')) {
        return
      }

      event.stopPropagation()
      setIsTitleEditing(true)
    },
    [isTitleEditable, isTitleEditing],
  )

  const handleHeaderClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.detail !== 2) {
        return
      }

      startTitleEditing(event)
    },
    [startTitleEditing],
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
      onClick={handleHeaderClick}
      onDoubleClick={startTitleEditing}
    >
      {labelColor ? (
        <span
          className="cove-label-dot cove-label-dot--solid"
          data-cove-label-color={labelColor}
          aria-hidden="true"
        />
      ) : null}
      {isTitleEditable ? (
        isTitleEditing ? (
          <span className="terminal-node__title-editable">
            {fixedTitlePrefix ? (
              <span className="terminal-node__title-prefix">{fixedTitlePrefix}</span>
            ) : null}
            <span className="terminal-node__title terminal-node__title-proxy" aria-hidden="true">
              {combineEditableTitle(titleDraft, fixedTitlePrefix)}
            </span>
            <input
              className="terminal-node__title-input nodrag nowheel"
              data-testid="terminal-node-inline-title-input"
              value={titleDraft}
              autoFocus
              onFocus={() => {
                setIsTitleEditing(true)
              }}
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
              }}
              onChange={event => {
                setTitleDraft(event.target.value)
              }}
              onBlur={() => {
                commitTitleEdit()
                setIsTitleEditing(false)
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelTitleEdit()
                  event.currentTarget.blur()
                  return
                }

                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
            />
          </span>
        ) : (
          <span className="terminal-node__title">{title}</span>
        )
      ) : (
        <span className="terminal-node__title">{title}</span>
      )}

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

  return title
}

function combineEditableTitle(title: string, fixedTitlePrefix: string | null): string {
  return fixedTitlePrefix ? `${fixedTitlePrefix}${title}` : title
}
