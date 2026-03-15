import { Handle, Position } from '@xyflow/react'
import { Pencil } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  AgentRuntimeStatus,
  Size,
  TaskAgentSessionRecord,
  TaskPriority,
  TaskRuntimeStatus,
} from '@contexts/workspace/presentation/renderer/types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { TaskNodeAgentSessions } from './taskNode/TaskNodeAgentSessions'
import { TaskNodeFooter } from './taskNode/TaskNodeFooter'
import { MIN_HEIGHT, MIN_WIDTH, shouldStopWheelPropagation } from './taskNode/helpers'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'

interface TaskNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  shiftKey?: boolean
}

interface TaskNodeProps {
  title: string
  requirement: string
  status: TaskRuntimeStatus
  priority: TaskPriority
  tags: string[]
  isEnriching: boolean
  linkedAgentNode: {
    nodeId: string
    title: string
    provider: AgentProvider
    status: AgentRuntimeStatus | null
    startedAt: string | null
  } | null
  agentSessions: TaskAgentSessionRecord[]
  currentDirectory: string
  width: number
  height: number
  onClose: () => void
  onOpenEditor: () => void
  onQuickTitleSave: (title: string) => void
  onQuickRequirementSave: (requirement: string) => void
  onRunAgent: () => void
  onResize: (size: Size) => void
  onStatusChange: (status: TaskRuntimeStatus) => void
  onResumeAgentSession: (recordId: string) => void
  onRemoveAgentSessionRecord: (recordId: string) => void
  onInteractionStart?: (options?: TaskNodeInteractionOptions) => void
}

type ResizeAxis = 'horizontal' | 'vertical'

export function TaskNode({
  title,
  requirement,
  status,
  priority,
  tags,
  isEnriching,
  linkedAgentNode,
  agentSessions,
  currentDirectory,
  width,
  height,
  onClose,
  onOpenEditor,
  onQuickTitleSave,
  onQuickRequirementSave,
  onRunAgent,
  onResize,
  onStatusChange,
  onResumeAgentSession,
  onRemoveAgentSessionRecord,
  onInteractionStart,
}: TaskNodeProps): JSX.Element {
  const { t } = useTranslation()
  const resizeStartRef = useRef<{
    x: number
    y: number
    width: number
    height: number
    axis: ResizeAxis
  } | null>(null)
  const draftSizeRef = useRef<Size | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [draftSize, setDraftSize] = useState<Size | null>(null)

  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [isRequirementEditing, setIsRequirementEditing] = useState(false)
  const [requirementDraft, setRequirementDraft] = useState(requirement)

  useEffect(() => {
    draftSizeRef.current = draftSize
  }, [draftSize])

  useEffect(() => {
    if (!draftSize || isResizing) {
      return
    }

    if (draftSize.width === width && draftSize.height === height) {
      setDraftSize(null)
    }
  }, [draftSize, height, isResizing, width])

  useEffect(() => {
    if (isTitleEditing) {
      return
    }

    setTitleDraft(title)
  }, [isTitleEditing, title])

  useEffect(() => {
    if (isRequirementEditing) {
      return
    }

    setRequirementDraft(requirement)
  }, [isRequirementEditing, requirement])

  const handleResizePointerDown = useCallback(
    (axis: ResizeAxis) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)

      resizeStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        width,
        height,
        axis,
      }

      setDraftSize({ width, height })
      setIsResizing(true)
    },
    [height, width],
  )

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) {
        return
      }

      if (start.axis === 'horizontal') {
        const nextWidth = Math.max(MIN_WIDTH, Math.round(start.width + (event.clientX - start.x)))
        setDraftSize({ width: nextWidth, height: start.height })
        return
      }

      const nextHeight = Math.max(MIN_HEIGHT, Math.round(start.height + (event.clientY - start.y)))
      setDraftSize({ width: start.width, height: nextHeight })
    }

    const handlePointerUp = () => {
      setIsResizing(false)

      const finalSize = draftSizeRef.current ?? { width, height }
      onResize(finalSize)

      resizeStartRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [height, isResizing, onResize, width])

  const commitTitleDraft = useCallback(() => {
    const normalized = titleDraft.trim()
    if (normalized.length === 0) {
      setTitleDraft(title)
      return
    }

    if (normalized !== title) {
      onQuickTitleSave(normalized)
    }
  }, [onQuickTitleSave, title, titleDraft])

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(title)
  }, [title])

  const handleHeaderClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.detail !== 2 ||
      !(event.target instanceof Element) ||
      event.target.closest('.nodrag')
    ) {
      return
    }

    event.stopPropagation()
    setIsTitleEditing(true)
  }, [])

  const commitRequirementDraft = useCallback(() => {
    const normalized = requirementDraft.trim()
    if (normalized.length === 0) {
      setRequirementDraft(requirement)
      return
    }

    if (normalized !== requirement) {
      onQuickRequirementSave(normalized)
    }
  }, [onQuickRequirementSave, requirement, requirementDraft])

  const cancelRequirementEdit = useCallback(() => {
    setRequirementDraft(requirement)
  }, [requirement])

  const renderedSize = draftSize ?? { width, height }
  const style = useMemo(
    () => ({ width: renderedSize.width, height: renderedSize.height }),
    [renderedSize.height, renderedSize.width],
  )

  return (
    <div
      className={`task-node nowheel${isEnriching ? ' task-node--enriching' : ''}`}
      style={style}
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (
          event.detail === 2 &&
          event.target.closest('.task-node__header') &&
          !event.target.closest('.nodrag')
        ) {
          return
        }

        if (event.target.closest('.task-node__title-input, .task-node__requirement-input')) {
          event.stopPropagation()
          onInteractionStart?.({
            normalizeViewport: true,
            selectNode: false,
            shiftKey: event.shiftKey,
          })
          return
        }

        if (event.target.closest('.nodrag, button, input, textarea, select, a')) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({ shiftKey: event.shiftKey })
      }}
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="workspace-node-handle" />
      <Handle type="source" position={Position.Right} className="workspace-node-handle" />

      {isEnriching ? (
        <span
          className="task-node__enriching-spinner"
          data-testid="task-node-enrichment"
          aria-hidden="true"
        />
      ) : null}

      <div className="task-node__header" data-node-drag-handle="true" onClick={handleHeaderClick}>
        <div className="task-node__header-main">
          {isTitleEditing ? (
            <>
              <span className="task-node__title task-node__title-proxy" aria-hidden="true">
                {titleDraft}
              </span>
              <input
                className="task-node__title-input nodrag nowheel"
                data-testid="task-node-inline-title-input"
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
                  commitTitleDraft()
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
            <span className="task-node__title">{titleDraft}</span>
          )}
        </div>

        <div className="task-node__header-actions nodrag">
          <button
            type="button"
            className="task-node__icon-button task-node__icon-button--edit nodrag"
            data-testid="task-node-open-editor"
            onClick={event => {
              event.stopPropagation()
              onOpenEditor()
            }}
            aria-label={t('taskNode.openFullTaskEditor')}
            title={t('taskNode.openFullTaskEditor')}
          >
            <Pencil size={14} strokeWidth={2.2} />
          </button>

          <button
            type="button"
            className="task-node__icon-button task-node__icon-button--close nodrag"
            data-testid="task-node-close"
            onClick={event => {
              event.stopPropagation()
              onClose()
            }}
            aria-label={t('taskNode.deleteTask')}
            title={t('taskNode.deleteTask')}
          >
            ×
          </button>
        </div>
      </div>

      <div className="task-node__meta" data-testid="task-node-meta">
        <span className={`task-node__priority task-node__priority--${priority}`}>
          {getTaskPriorityLabel(t, priority).toUpperCase()}
        </span>

        <span className="task-node__tags" data-testid="task-node-tags">
          {tags.length > 0 ? (
            tags.map(tag => (
              <span key={tag} className="task-node__tag">
                #{tag}
              </span>
            ))
          ) : (
            <span className="task-node__tag task-node__tag--empty">{t('taskNode.noTags')}</span>
          )}
        </span>
      </div>

      <div className="task-node__content">
        <label>{t('taskNode.requirement')}</label>
        <div className="task-node__inline-editor">
          <textarea
            className="task-node__requirement-input nodrag nowheel"
            data-testid="task-node-inline-requirement-input"
            value={requirementDraft}
            onFocus={() => {
              setIsRequirementEditing(true)
            }}
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
            }}
            onChange={event => {
              setRequirementDraft(event.target.value)
            }}
            onBlur={() => {
              commitRequirementDraft()
              setIsRequirementEditing(false)
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelRequirementEdit()
                event.currentTarget.blur()
                return
              }

              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
          />
        </div>
      </div>

      <TaskNodeAgentSessions
        linkedAgentNode={linkedAgentNode}
        agentSessions={agentSessions}
        currentDirectory={currentDirectory}
        onResumeAgentSession={onResumeAgentSession}
        onRemoveAgentSessionRecord={onRemoveAgentSessionRecord}
      />

      <TaskNodeFooter status={status} onStatusChange={onStatusChange} onRunAgent={onRunAgent} />

      <button
        type="button"
        className="task-node__resizer task-node__resizer--right nodrag"
        onPointerDown={handleResizePointerDown('horizontal')}
        aria-label={t('taskNode.resizeWidth')}
        data-testid="task-resizer-right"
      />
      <button
        type="button"
        className="task-node__resizer task-node__resizer--bottom nodrag"
        onPointerDown={handleResizePointerDown('vertical')}
        aria-label={t('taskNode.resizeHeight')}
        data-testid="task-resizer-bottom"
      />
    </div>
  )
}
