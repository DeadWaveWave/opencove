import { Handle, Position } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { TaskNodeActionsMenu } from './taskNode/TaskNodeActionsMenu'
import { TaskNodeFooter } from './taskNode/TaskNodeFooter'
import { TaskNodeLabels } from './taskNode/TaskNodeLabels'
import { TaskNodeStatusSteps } from './taskNode/TaskNodeStatusSteps'
import { MIN_HEIGHT, MIN_WIDTH, shouldStopWheelPropagation } from './taskNode/helpers'
import type { LabelColor } from '@shared/types/labelColor'
import { InlineNodeTitleEditor } from '@contexts/workspace/presentation/renderer/components/shared/InlineNodeTitleEditor'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { WindowHeader } from '@contexts/workspace/presentation/renderer/components/shared/WindowHeader'
import { WindowPlate } from '@contexts/workspace/presentation/renderer/components/shared/WindowPlate'
import { EditIcon } from '@app/renderer/components/ui/pixelIcons'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { PixelSpinner } from '@app/renderer/components/ui/PixelSpinner'

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

  const [isRequirementEditing, setIsRequirementEditing] = useState(false)
  const [requirementDraft, setRequirementDraft] = useState(requirement)
  const requirementInputRef = useRef<HTMLTextAreaElement | null>(null)
  const hasFocusedEmptyRequirementRef = useRef(false)
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
    if (isRequirementEditing) {
      return
    }

    setRequirementDraft(requirement)
  }, [isRequirementEditing, requirement])

  useEffect(() => {
    if (requirement.trim().length > 0 || hasFocusedEmptyRequirementRef.current) {
      return
    }

    hasFocusedEmptyRequirementRef.current = true
    const frame = window.requestAnimationFrame(() => {
      requirementInputRef.current?.focus()
      const length = requirementInputRef.current?.value.length ?? 0
      requirementInputRef.current?.setSelectionRange(length, length)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [requirement])

  const insertFilePaths = useCallback(
    (input: HTMLTextAreaElement, files: FileList | null, uriList?: string): boolean => {
      const paths = files
        ? Array.from(files)
            .map(file => window.opencoveApi.filesystem.getPathForFile(file))
            .filter(path => path.length > 0)
        : []
      const uriPaths = (uriList ?? '')
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(value => value.startsWith('file://'))
        .map(value => {
          try {
            return decodeURIComponent(value.slice('file://'.length))
          } catch {
            return value.slice('file://'.length)
          }
        })
      const uniquePaths = [...new Set([...paths, ...uriPaths])]
      if (uniquePaths.length === 0) {
        return false
      }

      const insertion = uniquePaths.join('\n')
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      const nextValue = `${input.value.slice(0, start)}${insertion}${input.value.slice(end)}`
      setRequirementDraft(nextValue)
      onQuickRequirementSave(nextValue)
      window.requestAnimationFrame(() => {
        const nextCaret = start + insertion.length
        input.setSelectionRange(nextCaret, nextCaret)
      })
      return true
    },
    [onQuickRequirementSave],
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
      data-cove-part="window"
      data-cove-kind="task"
      data-task-status={status}
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

        // The title owns its clicks: one renames, one ending a grab does nothing.
        if (event.target.closest('[data-cove-title-gesture]')) {
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
        <PixelSpinner
          size={12}
          className="task-node__enriching-spinner"
          data-testid="task-node-enrichment"
        />
      ) : null}

      <WindowHeader
        className="task-node__header"
        kind="plan"
        labelColor={labelColor}
        icon={<NodeKindIcon kind="task" />}
        title={
          <InlineNodeTitleEditor
            value={title}
            placeholder={t('taskNode.untitledTitle')}
            ariaLabel={t('taskNode.titleInputLabel')}
            classNamePrefix="task-node"
            displayTestId="task-node-title-display"
            inputTestId="task-node-inline-title-input"
            movesWindow
            onCommit={onQuickTitleSave}
          />
        }
        titleIsDragSurface
        dragSurfaceTestId="task-node-header-drag-surface"
        trailingClassName="task-node__header-actions"
        actions={
          <TaskNodeActionsMenu
            workspaceId={workspaceId}
            currentRequirement={requirementDraft}
            onChangeRequirement={nextRequirement => {
              setRequirementDraft(nextRequirement)
              onQuickRequirementSave(nextRequirement)
            }}
            onOpenEditor={onOpenEditor}
          />
        }
        close={{
          label: t('taskNode.deleteTask'),
          className: 'task-node__icon-button--close',
          testId: 'task-node-close',
          onClose,
        }}
      />

      <WindowPlate kind="plan" />
      {/* The card under the header: the status and labels, the requirement, then the sessions and
          the run button, all one body on the plate with dotted rules between the rows. */}
      <div className="task-node__plate" data-cove-part="window-body">
        <div className="task-node__meta" data-testid="task-node-meta">
          <TaskNodeStatusSteps status={status} onStatusChange={onStatusChange} />

          <TaskNodeLabels priority={priority} tags={tags}>
            <IconButton
              label={t('taskNode.editMeta')}
              size="xs"
              className="task-node__meta-edit nodrag"
              data-testid="task-node-edit-meta"
              onClick={event => {
                event.stopPropagation()
                onOpenEditor()
              }}
            >
              <EditIcon size={12} />
            </IconButton>
          </TaskNodeLabels>
        </div>

        <div className="task-node__content">
          <div className="task-node__inline-editor">
            <textarea
              ref={requirementInputRef}
              className="task-node__requirement-input nodrag nowheel"
              data-testid="task-node-inline-requirement-input"
              aria-label={t('taskNode.requirement')}
              placeholder={t('taskNode.requirementPlaceholder')}
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
              onDragOver={event => {
                if (
                  event.dataTransfer?.files.length ||
                  event.dataTransfer?.types.includes('text/uri-list')
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={event => {
                event.preventDefault()
                event.stopPropagation()
                insertFilePaths(
                  event.currentTarget,
                  event.dataTransfer.files,
                  event.dataTransfer.getData('text/uri-list'),
                )
              }}
              onPaste={event => {
                const files = event.clipboardData.files
                const uriList = event.clipboardData.getData('text/uri-list')
                if (files.length === 0 && !uriList) {
                  return
                }

                if (insertFilePaths(event.currentTarget, files, uriList)) {
                  event.preventDefault()
                  event.stopPropagation()
                }
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

        <TaskNodeFooter
          sessions={
            <TaskNodeAgentSessions
              width={renderedFrame.size.width}
              linkedAgentNode={linkedAgentNode}
              agentSessions={agentSessions}
              currentDirectory={currentDirectory}
              onResumeAgentSession={onResumeAgentSession}
              onRemoveAgentSessionRecord={onRemoveAgentSessionRecord}
            />
          }
          onRunAgent={onRunAgent}
        />
      </div>

      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="task-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
