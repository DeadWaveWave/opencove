import React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  ViewportPortal,
  type NodeProps,
  type Node as ReactFlowNode,
} from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { LabelColor, NodeLabelColorOverride } from '@shared/types/labelColor'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'
import type {
  AgentRuntimeStatus,
  SpaceArchiveNodeSnapshot,
  SpaceArchiveRecord,
  TaskPriority,
  TaskRuntimeStatus,
} from '@contexts/workspace/presentation/renderer/types'
import { getStatusClassName } from '@contexts/workspace/presentation/renderer/components/terminalNode/status'

type TerminalLikeNodeData = {
  kind: 'terminal' | 'agent'
  title: string
  status: AgentRuntimeStatus | null
  labelColor: LabelColor | null
  providerLabel: string | null
}

type TaskNodeData = {
  kind: 'task'
  title: string
  requirement: string
  status: TaskRuntimeStatus
  priority: TaskPriority
  tags: string[]
  labelColor: LabelColor | null
}

type NoteNodeData = {
  kind: 'note'
  title: string
  text: string
  labelColor: LabelColor | null
}

type SpaceBoundsNodeData = {
  kind: 'spaceBounds'
}

type TerminalLikeNode = ReactFlowNode<TerminalLikeNodeData, 'terminalLike'>
type ArchivedTaskNodeType = ReactFlowNode<TaskNodeData, 'archivedTask'>
type ArchivedNoteNodeType = ReactFlowNode<NoteNodeData, 'archivedNote'>
type SpaceBoundsNodeType = ReactFlowNode<SpaceBoundsNodeData, 'spaceBounds'>

type SpaceArchiveReplayNode =
  | TerminalLikeNode
  | ArchivedTaskNodeType
  | ArchivedNoteNodeType
  | SpaceBoundsNodeType

function resolveEffectiveLabelColor({
  spaceLabelColor,
  override,
}: {
  spaceLabelColor: LabelColor | null
  override: NodeLabelColorOverride
}): LabelColor | null {
  if (override === 'none') {
    return null
  }

  if (override) {
    return override
  }

  return spaceLabelColor
}

function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}

function ArchivedTerminalLikeNode({ data }: NodeProps<TerminalLikeNode>): React.JSX.Element {
  const { t } = useTranslation()
  const isAgentNode = data.kind === 'agent'

  const statusLabel = (() => {
    switch (data.status) {
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
      className="terminal-node space-archive-replay__terminal"
      style={{ width: '100%', height: '100%' }}
      data-testid="space-archives-window-replay-node"
      data-node-kind={data.kind}
    >
      <div className="terminal-node__header" data-node-drag-handle="true">
        {data.labelColor ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={data.labelColor}
            aria-hidden="true"
          />
        ) : null}
        <span className="terminal-node__title">{data.title}</span>

        {isAgentNode ? (
          <div className="terminal-node__header-badges">
            <span className={`terminal-node__status ${getStatusClassName(data.status)}`}>
              {statusLabel}
            </span>
          </div>
        ) : null}
      </div>

      <div
        className="terminal-node__terminal space-archive-replay__terminal-body"
        aria-hidden="true"
      />
    </div>
  )
}

function ArchivedNoteNode({ data }: NodeProps<ArchivedNoteNodeType>): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="note-node space-archive-replay__note"
      style={{ width: '100%', height: '100%' }}
      data-testid="space-archives-window-replay-node"
      data-node-kind="note"
    >
      <div className="note-node__header" data-node-drag-handle="true">
        {data.labelColor ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={data.labelColor}
            aria-hidden="true"
          />
        ) : null}
        <span className="note-node__title">{t('noteNode.title')}</span>
      </div>

      <pre className="note-node__textarea space-archive-replay__note-text">{data.text}</pre>
    </div>
  )
}

function ArchivedTaskNode({ data }: NodeProps<ArchivedTaskNodeType>): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="task-node space-archive-replay__task"
      style={{ width: '100%', height: '100%' }}
      data-testid="space-archives-window-replay-node"
      data-node-kind="task"
    >
      <div className="task-node__header" data-node-drag-handle="true">
        <div className="task-node__header-main">
          <div className="task-node__title-row">
            {data.labelColor ? (
              <span
                className="cove-label-dot cove-label-dot--solid"
                data-cove-label-color={data.labelColor}
                aria-hidden="true"
              />
            ) : null}
            <span className="task-node__title">{data.title}</span>
          </div>
        </div>
      </div>

      <div className="task-node__meta">
        <span className={`task-node__priority task-node__priority--${data.priority}`}>
          {getTaskPriorityLabel(t, data.priority).toUpperCase()}
        </span>

        <span className="task-node__tags">
          {data.tags.length > 0 ? (
            data.tags.map(tag => (
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
          <pre className="task-node__requirement-input space-archive-replay__task-requirement">
            {data.requirement}
          </pre>
        </div>
      </div>
    </div>
  )
}

function SpaceBoundsNode(_props: NodeProps<SpaceBoundsNodeType>): React.JSX.Element | null {
  return null
}

function hasFrame(
  node: SpaceArchiveNodeSnapshot,
): node is SpaceArchiveNodeSnapshot & { frame: NonNullable<SpaceArchiveNodeSnapshot['frame']> } {
  return node.frame !== null
}

function toReactFlowNodes(record: SpaceArchiveRecord): SpaceArchiveReplayNode[] {
  const nodesWithFrame = record.nodes.filter(hasFrame)
  const shouldRenderNodes = nodesWithFrame.length === record.nodes.length
  const resolvedSpaceLabelColor = record.space.labelColor ?? null

  const replayNodes: SpaceArchiveReplayNode[] = []

  if (record.space.rect) {
    replayNodes.push({
      id: `space-bounds:${record.id}`,
      type: 'spaceBounds',
      position: { x: record.space.rect.x, y: record.space.rect.y },
      data: { kind: 'spaceBounds' },
      style: {
        width: record.space.rect.width,
        height: record.space.rect.height,
        opacity: 0,
        pointerEvents: 'none',
      },
      draggable: false,
      selectable: false,
      focusable: false,
    })
  }

  if (!shouldRenderNodes) {
    return replayNodes
  }

  for (const node of nodesWithFrame) {
    const effectiveLabelColor = resolveEffectiveLabelColor({
      spaceLabelColor: resolvedSpaceLabelColor,
      override: node.labelColorOverride,
    })

    if (node.kind === 'terminal' || node.kind === 'agent') {
      replayNodes.push({
        id: node.id,
        type: 'terminalLike',
        position: { x: node.frame.position.x, y: node.frame.position.y },
        data: {
          kind: node.kind,
          title: node.title,
          status: node.kind === 'agent' ? node.status : null,
          labelColor: effectiveLabelColor,
          providerLabel: node.kind === 'agent' ? node.provider : null,
        },
        style: {
          width: node.frame.size.width,
          height: node.frame.size.height,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      })
      continue
    }

    if (node.kind === 'task') {
      replayNodes.push({
        id: node.id,
        type: 'archivedTask',
        position: { x: node.frame.position.x, y: node.frame.position.y },
        data: {
          kind: 'task',
          title: node.title,
          requirement: node.requirement,
          status: node.status,
          priority: node.priority,
          tags: node.tags,
          labelColor: effectiveLabelColor,
        },
        style: {
          width: node.frame.size.width,
          height: node.frame.size.height,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      })
      continue
    }

    if (node.kind === 'note') {
      replayNodes.push({
        id: node.id,
        type: 'archivedNote',
        position: { x: node.frame.position.x, y: node.frame.position.y },
        data: {
          kind: 'note',
          title: node.title,
          text: node.text,
          labelColor: effectiveLabelColor,
        },
        style: {
          width: node.frame.size.width,
          height: node.frame.size.height,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      })
    }
  }

  return replayNodes
}

function ArchivedSpaceRegion({ record }: { record: SpaceArchiveRecord }): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!record.space.rect) {
    return null
  }

  const branchBadge = record.git?.branch
    ? {
        kind: t('worktree.branch'),
        value: record.git.branch,
        title: record.git.branch,
      }
    : record.git?.head
      ? {
          kind: t('worktree.detached'),
          value: toShortSha(record.git.head),
          title: record.git.head,
        }
      : null

  const pullRequest = record.git?.pullRequest ?? null
  const pullRequestUrl = pullRequest?.ref.url ?? null

  return (
    <div
      className="workspace-space-region workspace-space-region--selected space-archive-replay__space"
      data-cove-label-color={record.space.labelColor ?? undefined}
      style={{
        transform: `translate(${record.space.rect.x}px, ${record.space.rect.y}px)`,
        width: record.space.rect.width,
        height: record.space.rect.height,
      }}
      data-testid="space-archives-window-replay-space"
    >
      <div className="workspace-space-region__label-group space-archive-replay__space-label-group">
        <span className="workspace-space-region__label">
          {record.space.labelColor ? (
            <span
              className="cove-label-dot cove-label-dot--solid"
              data-cove-label-color={record.space.labelColor}
              aria-hidden="true"
            />
          ) : null}
          {record.space.name}
        </span>

        {branchBadge ? (
          <span className="workspace-space-region__branch-badge" title={branchBadge.title}>
            <span className="workspace-space-region__branch-badge-kind">{branchBadge.kind}</span>
            <span className="workspace-space-region__branch-badge-value">{branchBadge.value}</span>
          </span>
        ) : null}

        {pullRequestUrl && pullRequest ? (
          <a
            className="workspace-space-region__pr-chip"
            href={pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            title={`${pullRequest.title} (#${pullRequest.number})`}
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <span className="workspace-space-region__pr-chip-kind">PR</span>
            <span className="workspace-space-region__pr-chip-value">{`#${pullRequest.number}`}</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}

export function SpaceArchiveReplayCanvas({
  record,
}: {
  record: SpaceArchiveRecord
}): React.JSX.Element {
  const { t } = useTranslation()
  const nodes = React.useMemo(() => toReactFlowNodes(record), [record])
  const nodesWithFrameCount = record.nodes.filter(hasFrame).length
  const hasFullLayout = nodesWithFrameCount === record.nodes.length

  if (record.nodes.length > 0 && !hasFullLayout) {
    return (
      <div className="space-archives-window__layout">
        <div className="space-archives-window__layout-title">
          {t('spaceArchivesWindow.replayTitle')}
        </div>
        <p className="space-archives-window__layout-empty">
          {t('spaceArchivesWindow.layoutUnavailable')}
        </p>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="space-archives-window__layout">
        <div className="space-archives-window__layout-title">
          {t('spaceArchivesWindow.replayTitle')}
        </div>
        <p className="space-archives-window__layout-empty">
          {t('spaceArchivesWindow.layoutEmpty')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-archives-window__layout" data-testid="space-archives-window-replay">
      <div className="space-archives-window__layout-title">
        {t('spaceArchivesWindow.replayTitle')}
      </div>
      <div
        className="workspace-canvas space-archive-replay__canvas"
        data-testid="space-archives-window-replay-canvas"
      >
        <ReactFlow<SpaceArchiveReplayNode>
          nodes={nodes}
          edges={[]}
          nodeTypes={{
            terminalLike: ArchivedTerminalLikeNode,
            archivedTask: ArchivedTaskNode,
            archivedNote: ArchivedNoteNode,
            spaceBounds: SpaceBoundsNode,
          }}
          nodesDraggable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          zoomOnScroll
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            size={1}
            gap={24}
            color="var(--cove-canvas-dot)"
          />
          <ViewportPortal>
            <ArchivedSpaceRegion record={record} />
          </ViewportPortal>
          <Controls className="workspace-canvas__controls" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
