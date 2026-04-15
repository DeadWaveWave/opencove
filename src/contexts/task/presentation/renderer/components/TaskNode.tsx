import { Handle, Position } from '@xyflow/react'
import { FileText, Pencil } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type {
  AgentRuntimeStatus,
  NodeFrame,
  Point,
  TaskAgentSessionRecord,
  TaskPriority,
  TaskRuntimeStatus,
} from '@contexts/workspace/presentation/renderer/types'
import { NodeResizeHandles } from '@contexts/workspace/presentation/renderer/components/shared/NodeResizeHandles'
import { useNodeFrameResize } from '@contexts/workspace/presentation/renderer/utils/nodeFrameResize'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { TaskNodeAgentSessions } from './taskNode/TaskNodeAgentSessions'
import { TaskNodeFooter } from './taskNode/TaskNodeFooter'
import { MIN_HEIGHT, MIN_WIDTH, shouldStopWheelPropagation } from './taskNode/helpers'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'
import type { LabelColor } from '@shared/types/labelColor'
import { TaskPromptTemplatesMenu } from './promptTemplates/TaskPromptTemplatesMenu'

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
  labelColor?: LabelColor | null
  linkedAgentNode: {
    nodeId: string
    title: string
    provider: AgentProvider
    status: AgentRuntimeStatus | null
    startedAt: string | null
  } | null
  agentSessions: TaskAgentSessionRecord[]
  currentDirectory: string
  position: Point
  width: number
  height: number
  onClose: () => void
  onOpenEditor: () => void
  onQuickTitleSave: (title: string) => void
  onQuickRequirementSave: (requirement: string) => void
  onRunAgent: () => void
  onResize: (frame: NodeFrame) => void
  onStatusChange: (status: TaskRuntimeStatus) => void
  onResumeAgentSession: (recordId: string) => void
  onRemoveAgentSessionRecord: (recordId: string) => void
  onInteractionStart?: (options?: TaskNodeInteractionOptions) => void
}

export function TaskNode({
  title,
  requirement,
  status,
  priority,
  tags,
  isEnriching,
  labelColor,
  linkedAgentNode,
  agentSessions,
  currentDirectory,
  position,
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
  const workspaceId = useAppStore(state => state.activeWorkspaceId)

  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [isRequirementEditing, setIsRequirementEditing] = useState(false)
  const [requirementDraft, setRequirementDraft] = useState(requirement)
  const [promptTemplatesMenuAnchor, setPromptTemplatesMenuAnchor] = useState<{
    x: number
    y: number
  } | null>(null)
  const promptTemplatesTriggerRef = React.useRef<HTMLButtonElement | null>(null)

  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: {
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    },
    onResize,
  })

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

  const startTitleEditing = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isTitleEditing) {
        return
      }

      if (event.target instanceof Element && event.target.closest('.nodrag')) {
        return
      }

      event.stopPropagation()
      setIsTitleEditing(true)
    },
    [isTitleEditing],
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

  const isPromptTemplatesMenuOpen = promptTemplatesMenuAnchor !== null

  const renderedFrame = draftFrame ?? {
    position,
    size: { width, height },
  }
  const style = useMemo(
    () => ({
      width: renderedFrame.size.width,
      height: renderedFrame.size.height,
      transform:
        renderedFrame.position.x !== position.x || renderedFrame.position.y !== position.y
          ? `translate(${renderedFrame.position.x - position.x}px, ${renderedFrame.position.y - position.y}px)`
          : undefined,
    }),
    [
      position.x,
      position.y,
      renderedFrame.position.x,
      renderedFrame.position.y,
      renderedFrame.size.height,
      renderedFrame.size.width,
    ],
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

      <div
        className="task-node__header"
        data-node-drag-handle="true"
        onClick={handleHeaderClick}
        onDoubleClick={startTitleEditing}
      >
        <div className="task-node__header-main">
          <div className="task-node__title-row">
            {labelColor ? (
              <span
                className="cove-label-dot cove-label-dot--solid"
                data-cove-label-color={labelColor}
                aria-hidden="true"
              />
            ) : null}

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
        </div>

        <div className="task-node__header-actions nodrag">
          <button
            ref={promptTemplatesTriggerRef}
            type="button"
            className="task-node__icon-button task-node__icon-button--templates nodrag"
            data-testid="task-node-open-prompt-templates"
            onClick={event => {
              event.stopPropagation()

              if (isPromptTemplatesMenuOpen) {
                setPromptTemplatesMenuAnchor(null)
                return
              }

              const rect = event.currentTarget.getBoundingClientRect()
              setPromptTemplatesMenuAnchor({
                x: rect.right,
                y: rect.bottom,
              })
            }}
            aria-label={t('taskPromptTemplates.openMenu')}
            title={t('taskPromptTemplates.openMenu')}
          >
            <FileText size={14} strokeWidth={2.2} />
          </button>

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

      <TaskPromptTemplatesMenu
        isOpen={isPromptTemplatesMenuOpen}
        anchor={promptTemplatesMenuAnchor}
        workspaceId={workspaceId}
        closeMenu={() => {
          setPromptTemplatesMenuAnchor(null)
        }}
        triggerRef={promptTemplatesTriggerRef}
        currentRequirement={requirementDraft}
        onChangeRequirement={nextRequirement => {
          setRequirementDraft(nextRequirement)
          onQuickRequirementSave(nextRequirement)
        }}
        testIdPrefix="task-node"
      />

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

      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="task-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
