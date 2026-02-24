import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import { getStatusClassName, getStatusLabel } from './status'

interface TerminalNodeHeaderProps {
  title: string
  kind: WorkspaceNodeKind
  status: AgentRuntimeStatus | null
  onTitleCommit?: (title: string) => void
  onClose: () => void
  onStop?: () => void
  onRerun?: () => void
  onResume?: () => void
}

export function TerminalNodeHeader({
  title,
  kind,
  status,
  onTitleCommit,
  onClose,
  onStop,
  onRerun,
  onResume,
}: TerminalNodeHeaderProps): JSX.Element {
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)

  const isTitleEditable = kind === 'terminal' && typeof onTitleCommit === 'function'
  const isAgentNode = kind === 'agent'
  const canStop =
    isAgentNode &&
    (status === 'running' || status === 'restoring' || status === null) &&
    typeof onStop === 'function'

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
      setIsTitleEditing(false)
      return
    }

    if (normalizedTitle !== title) {
      onTitleCommit(normalizedTitle)
    }

    setIsTitleEditing(false)
  }, [isTitleEditable, onTitleCommit, title, titleDraft])

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(title)
    setIsTitleEditing(false)
  }, [title])

  return (
    <div className="terminal-node__header" data-node-drag-handle="true">
      {isTitleEditable ? (
        isTitleEditing ? (
          <input
            className="terminal-node__title terminal-node__title-input nodrag nowheel"
            data-testid="terminal-node-inline-title-input"
            value={titleDraft}
            autoFocus
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onChange={event => {
              setTitleDraft(event.target.value)
            }}
            onBlur={() => {
              commitTitleEdit()
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelTitleEdit()
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitleEdit()
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="terminal-node__title terminal-node__title-button nodrag"
            data-testid="terminal-node-inline-title-trigger"
            onClick={event => {
              event.stopPropagation()
              setTitleDraft(title)
              setIsTitleEditing(true)
            }}
          >
            {title}
          </button>
        )
      ) : (
        <span className="terminal-node__title">{title}</span>
      )}

      {isAgentNode ? (
        <div className="terminal-node__agent-controls nodrag">
          <span className={`terminal-node__status ${getStatusClassName(status)}`}>
            {getStatusLabel(status)}
          </span>
          <button
            type="button"
            className="terminal-node__action"
            disabled={!canStop}
            onClick={event => {
              event.stopPropagation()
              onStop?.()
            }}
          >
            Stop
          </button>
          <button
            type="button"
            className="terminal-node__action"
            disabled={typeof onRerun !== 'function'}
            onClick={event => {
              event.stopPropagation()
              onRerun?.()
            }}
          >
            Rerun
          </button>
          <button
            type="button"
            className="terminal-node__action"
            disabled={typeof onResume !== 'function'}
            onClick={event => {
              event.stopPropagation()
              onResume?.()
            }}
          >
            Resume
          </button>
        </div>
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
