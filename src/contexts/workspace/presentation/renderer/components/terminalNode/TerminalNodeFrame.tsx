import React, { useId, type JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Handle, Position } from '@xyflow/react'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import { TerminalNodeHeader } from './TerminalNodeHeader'
import { TerminalNodeFindBar } from './TerminalNodeFindBar'
import { NodeResizeHandles } from '../shared/NodeResizeHandles'
import { resolveTerminalNodeInteraction } from './interaction'
import { shouldStopWheelPropagation } from './wheel'
import type { AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import type { TerminalNodeInteractionOptions } from '../TerminalNode.types'
import type { ResizeEdges } from '../../utils/nodeFrameResize'

interface TerminalNodeFrameProps {
  title: string
  fixedTitlePrefix?: string | null
  kind: WorkspaceNodeKind
  labelColor?: LabelColor | null
  agentExecutionDirectory?: string | null
  agentResumeSessionId?: string | null
  agentResumeSessionIdVerified?: boolean
  isSelected: boolean
  isDragging: boolean
  status: AgentRuntimeStatus | null
  directoryMismatch?: { executionDirectory: string; expectedDirectory: string } | null
  lastError: string | null
  sessionId: string
  isTerminalHydrated: boolean
  isRecoveringAgentOutput: boolean
  transcriptRef: React.Ref<HTMLDivElement>
  sizeStyle: React.CSSProperties
  containerRef: React.RefObject<HTMLDivElement | null>
  handleTerminalBodyPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleTerminalBodyPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleTerminalBodyPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  consumeIgnoredTerminalBodyClick: (target: EventTarget | null) => boolean
  onInteractionStart?: (options?: TerminalNodeInteractionOptions) => void
  onTitleCommit?: (title: string) => void
  onClose: () => void
  onCopyLastMessage?: () => Promise<void>
  onReloadSession?: () => Promise<void>
  onListSessions?: (limit?: number) => Promise<AgentSessionSummary[]>
  onSwitchSession?: (summary: AgentSessionSummary) => Promise<void>
  find: {
    isOpen: boolean
    query: string
    resultIndex: number
    resultCount: number
    caseSensitive: boolean
    useRegex: boolean
  }
  onFindQueryChange: (query: string) => void
  onFindNext: () => void
  onFindPrevious: () => void
  onFindClose: () => void
  onFindToggleCaseSensitive: () => void
  onFindToggleUseRegex: () => void
  handleResizePointerDown: (edges: ResizeEdges) => (event: React.PointerEvent<HTMLElement>) => void
}

export function TerminalNodeFrame({
  title,
  fixedTitlePrefix,
  kind,
  labelColor,
  agentExecutionDirectory,
  agentResumeSessionId,
  agentResumeSessionIdVerified = false,
  isSelected,
  isDragging,
  status,
  directoryMismatch,
  lastError,
  sessionId,
  isTerminalHydrated,
  isRecoveringAgentOutput,
  transcriptRef,
  sizeStyle,
  containerRef,
  handleTerminalBodyPointerDownCapture,
  handleTerminalBodyPointerMoveCapture,
  handleTerminalBodyPointerUp,
  consumeIgnoredTerminalBodyClick,
  onInteractionStart,
  onTitleCommit,
  onClose,
  onCopyLastMessage,
  onReloadSession,
  onListSessions,
  onSwitchSession,
  find,
  onFindQueryChange,
  onFindNext,
  onFindPrevious,
  onFindClose,
  onFindToggleCaseSensitive,
  onFindToggleUseRegex,
  handleResizePointerDown,
}: TerminalNodeFrameProps): JSX.Element {
  const { t } = useTranslation()
  const isAgentNode = kind === 'agent'
  const hasTargetHandle = kind === 'agent'
  const hasSourceHandle = kind === 'task'
  const hasSelectedDragSurface = isSelected || isDragging
  const terminalElementId = useId()

  return (
    <div
      className={`terminal-node nowheel ${hasSelectedDragSurface ? 'terminal-node--selected-surface' : ''}`.trim()}
      style={sizeStyle}
      onPointerDownCapture={handleTerminalBodyPointerDownCapture}
      onPointerMoveCapture={handleTerminalBodyPointerMoveCapture}
      onPointerUp={handleTerminalBodyPointerUp}
      onClickCapture={event => {
        if (event.button !== 0) {
          return
        }

        if (
          event.target instanceof Element &&
          !event.target.closest('.terminal-node__terminal') &&
          document.activeElement instanceof HTMLElement &&
          document.activeElement.closest('[data-cove-focus-scope=terminal]')
        ) {
          // Clicking terminal chrome (header/badges/close) should release terminal focus so that
          // workspace-level shortcuts work deterministically (especially in E2E where terminals
          // auto-focus on mount).
          document.activeElement.blur()
        }

        if (
          event.detail === 2 &&
          event.target instanceof Element &&
          event.target.closest('.terminal-node__header') &&
          !event.target.closest('.nodrag')
        ) {
          return
        }

        if (consumeIgnoredTerminalBodyClick(event.target)) {
          event.stopPropagation()
          return
        }

        if (event.target instanceof Element && event.target.closest('.nodrag')) {
          return
        }

        const interaction = resolveTerminalNodeInteraction(event.target)
        if (!interaction) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({
          normalizeViewport: interaction.normalizeViewport,
          selectNode: interaction.selectNode || event.shiftKey,
          shiftKey: event.shiftKey,
        })
      }}
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      {hasTargetHandle ? (
        <Handle type="target" position={Position.Left} className="workspace-node-handle" />
      ) : null}
      {hasSourceHandle ? (
        <Handle type="source" position={Position.Right} className="workspace-node-handle" />
      ) : null}

      <TerminalNodeHeader
        title={title}
        fixedTitlePrefix={fixedTitlePrefix}
        kind={kind}
        status={status}
        labelColor={labelColor ?? null}
        agentExecutionDirectory={agentExecutionDirectory}
        agentResumeSessionId={agentResumeSessionId}
        agentResumeSessionIdVerified={agentResumeSessionIdVerified}
        directoryMismatch={directoryMismatch}
        onHeaderPointerDownCapture={event => {
          if (event.button !== 0 || event.shiftKey || isSelected) {
            return
          }

          if (!(event.target instanceof Element) || event.target.closest('.nodrag')) {
            return
          }

          onInteractionStart?.({
            normalizeViewport: false,
            selectNode: true,
            shiftKey: false,
          })
        }}
        onTitleCommit={onTitleCommit}
        onClose={onClose}
        onCopyLastMessage={onCopyLastMessage}
        onReloadSession={onReloadSession}
        onListSessions={onListSessions}
        onSwitchSession={onSwitchSession}
      />

      {isAgentNode && lastError ? <div className="terminal-node__error">{lastError}</div> : null}

      <div className="terminal-node__body">
        <div
          id={terminalElementId}
          ref={containerRef}
          className={`terminal-node__terminal nodrag ${isTerminalHydrated ? '' : 'terminal-node__terminal--hydrating'}`.trim()}
          data-cove-focus-scope="terminal"
          aria-busy={sessionId.trim().length > 0 && isTerminalHydrated ? 'false' : 'true'}
        />

        <TerminalNodeFindBar
          isOpen={find.isOpen}
          query={find.query}
          resultIndex={find.resultIndex}
          resultCount={find.resultCount}
          caseSensitive={find.caseSensitive}
          useRegex={find.useRegex}
          terminalElementId={terminalElementId}
          onQueryChange={onFindQueryChange}
          onFindNext={onFindNext}
          onFindPrevious={onFindPrevious}
          onClose={onFindClose}
          onToggleCaseSensitive={onFindToggleCaseSensitive}
          onToggleUseRegex={onFindToggleUseRegex}
        />

        {isRecoveringAgentOutput ? (
          <div className="terminal-node__recovering" role="status">
            <span className="terminal-node__recovering-dot" aria-hidden="true" />
            <span>{t('terminalNode.recoveringAgentSession')}</span>
          </div>
        ) : null}
      </div>
      <div ref={transcriptRef} className="terminal-node__transcript" aria-hidden="true" />

      <NodeResizeHandles
        classNamePrefix="terminal-node"
        testIdPrefix="terminal-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
