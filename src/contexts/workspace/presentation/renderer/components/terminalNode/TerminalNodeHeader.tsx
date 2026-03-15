import React, { useCallback, useEffect, useState, type JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { FileText, LoaderCircle } from 'lucide-react'
import type { AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import { getStatusClassName } from './status'

interface TerminalNodeHeaderProps {
  title: string
  kind: WorkspaceNodeKind
  status: AgentRuntimeStatus | null
  directoryMismatch?: { executionDirectory: string; expectedDirectory: string } | null
  onTitleCommit?: (title: string) => void
  onClose: () => void
  onSaveLastMessageToNote?: () => Promise<void>
}

export function TerminalNodeHeader({
  title,
  kind,
  status,
  directoryMismatch,
  onTitleCommit,
  onClose,
  onSaveLastMessageToNote,
}: TerminalNodeHeaderProps): JSX.Element {
  const { t } = useTranslation()
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [isSavingLastMessageToNote, setIsSavingLastMessageToNote] = useState(false)

  const isTitleEditable = kind === 'terminal' && typeof onTitleCommit === 'function'
  const isAgentNode = kind === 'agent'
  const canSaveLastMessageToNote =
    isAgentNode && status === 'standby' && typeof onSaveLastMessageToNote === 'function'

  useEffect(() => {
    if (isTitleEditing) {
      return
    }

    setTitleDraft(title)
  }, [isTitleEditing, title])

  const commitTitleEdit = useCallback(() => {
    if (!isTitleEditable) {
      return
    }

    const normalizedTitle = titleDraft.trim()
    if (normalizedTitle.length === 0) {
      setTitleDraft(title)
      return
    }

    if (normalizedTitle !== title) {
      onTitleCommit(normalizedTitle)
    }
  }, [isTitleEditable, onTitleCommit, title, titleDraft])

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(title)
  }, [title])

  const handleHeaderClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        event.detail !== 2 ||
        !isTitleEditable ||
        isTitleEditing ||
        !(event.target instanceof Element) ||
        event.target.closest('.nodrag')
      ) {
        return
      }

      event.stopPropagation()
      setIsTitleEditing(true)
    },
    [isTitleEditable, isTitleEditing],
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
    <div className="terminal-node__header" data-node-drag-handle="true" onClick={handleHeaderClick}>
      {isTitleEditable ? (
        isTitleEditing ? (
          <>
            <span className="terminal-node__title terminal-node__title-proxy" aria-hidden="true">
              {titleDraft}
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
          </>
        ) : (
          <span className="terminal-node__title">{titleDraft}</span>
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

      {canSaveLastMessageToNote ? (
        <button
          type="button"
          className="terminal-node__action terminal-node__action--icon nodrag"
          data-testid="terminal-node-save-last-message"
          aria-label={t('terminalNodeHeader.saveLastMessageToNote')}
          title={
            isSavingLastMessageToNote
              ? t('terminalNodeHeader.savingLastMessageToNote')
              : t('terminalNodeHeader.saveLastMessageToNote')
          }
          disabled={isSavingLastMessageToNote}
          onClick={async event => {
            event.stopPropagation()
            if (isSavingLastMessageToNote || !onSaveLastMessageToNote) {
              return
            }

            setIsSavingLastMessageToNote(true)

            try {
              await onSaveLastMessageToNote()
            } finally {
              setIsSavingLastMessageToNote(false)
            }
          }}
        >
          {isSavingLastMessageToNote ? (
            <LoaderCircle className="terminal-node__action-icon terminal-node__action-icon--spinning" />
          ) : (
            <FileText className="terminal-node__action-icon" />
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
