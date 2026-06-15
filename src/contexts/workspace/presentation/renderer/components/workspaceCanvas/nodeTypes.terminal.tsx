import React, { useCallback, type MutableRefObject, type ReactElement } from 'react'
import { useStore, useStoreApi, type Node } from '@xyflow/react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { LabelColor } from '@shared/types/labelColor'
import { TerminalNode } from '../TerminalNode'
import { useScrollbackStore } from '../../store/useScrollbackStore'
import type { NodeFrame, TerminalNodeData } from '../../types'
import { isResumeSessionBindingVerified } from '../../utils/agentResumeBinding'
import {
  findLinkedTaskTitleForAgent,
  providerTitlePrefix,
  resolveAgentDisplayTitle,
} from '../../utils/agentTitle'
import { readNodePositionFromStoreState } from './nodePosition'
import type { UpdateNodeScrollback } from './types'

function WorkspaceCanvasTerminalNodeTypeComponent({
  data,
  id,
  selected,
  dragging,
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
  selectNode,
  closeNodeRef,
  resizeNodeRef,
  copyAgentLastMessageRef,
  reloadAgentSessionRef,
  listAgentSessionsRef,
  switchAgentSessionRef,
  updateNodeScrollbackRef,
  normalizeViewportForTerminalInteractionRef,
  updateTerminalTitleRef,
  renameTerminalTitleRef,
}: {
  data: TerminalNodeData
  id: string
  selected?: boolean
  dragging?: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  copyAgentLastMessageRef: MutableRefObject<(nodeId: string) => Promise<void>>
  reloadAgentSessionRef: MutableRefObject<(nodeId: string) => Promise<void>>
  listAgentSessionsRef: MutableRefObject<
    (
      nodeId: string,
      limit?: number,
    ) => Promise<import('@shared/contracts/dto').AgentSessionSummary[]>
  >
  switchAgentSessionRef: MutableRefObject<
    (nodeId: string, summary: import('@shared/contracts/dto').AgentSessionSummary) => Promise<void>
  >
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  updateTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}): ReactElement {
  const storeApi = useStoreApi()
  const scrollback = useScrollbackStore(state =>
    data.kind === 'agent' ? null : (state.scrollbackByNodeId[id] ?? data.scrollback ?? null),
  )
  const getNodePosition = useCallback(() => {
    return readNodePositionFromStoreState(storeApi.getState(), id)
  }, [id, storeApi])
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null
  const resolvedTerminalProvider =
    data.kind === 'agent' ? (data.agent?.provider ?? null) : (data.terminalProviderHint ?? null)
  const linkedTaskTitle = useStore(storeState => {
    if (data.kind !== 'agent' || !data.agent) {
      return null
    }

    const state = storeState as unknown as {
      nodeLookup?: { values?: unknown }
      nodeInternals?: { values?: unknown }
      nodes?: Array<Node<TerminalNodeData>>
    }
    const lookup = state.nodeLookup ?? state.nodeInternals
    const lookupNodes =
      lookup && typeof lookup.values === 'function'
        ? Array.from((lookup as Map<string, Node<TerminalNodeData>>).values())
        : null

    return findLinkedTaskTitleForAgent(
      lookupNodes ?? state.nodes ?? [],
      id,
      data.agent.taskId ?? null,
    )
  })
  const resolvedTitle =
    data.kind === 'agent' && data.agent
      ? data.titlePinnedByUser === true
        ? data.title.trim()
        : resolveAgentDisplayTitle({
            provider: data.agent.provider,
            linkedTaskTitle,
            fallbackTitle: data.title,
          })
      : data.title

  return (
    <TerminalNode
      nodeId={id}
      sessionId={data.sessionId}
      title={resolvedTitle}
      fixedTitlePrefix={
        data.kind === 'agent' && data.agent
          ? `${providerTitlePrefix(data.agent.provider)} · `
          : null
      }
      kind={data.kind}
      labelColor={labelColor}
      agentLaunchMode={data.kind === 'agent' ? (data.agent?.launchMode ?? null) : null}
      agentExecutionDirectory={
        data.kind === 'agent' ? (data.agent?.executionDirectory ?? null) : null
      }
      agentResumeSessionId={data.kind === 'agent' ? (data.agent?.resumeSessionId ?? null) : null}
      agentResumeSessionIdVerified={
        data.kind === 'agent' && data.agent ? isResumeSessionBindingVerified(data.agent) : false
      }
      terminalProvider={resolvedTerminalProvider}
      isLiveSessionReattach={data.isLiveSessionReattach === true}
      autoFocus={data.autoFocus === true}
      terminalGeometry={data.terminalGeometry ?? null}
      terminalThemeMode="sync-with-ui"
      isSelected={selected === true}
      isDragging={dragging === true}
      status={data.status}
      directoryMismatch={
        data.kind === 'agent' &&
        data.agent?.expectedDirectory &&
        data.agent.expectedDirectory !== data.agent.executionDirectory
          ? {
              executionDirectory: data.agent.executionDirectory,
              expectedDirectory: data.agent.expectedDirectory,
            }
          : data.kind === 'terminal' &&
              data.executionDirectory &&
              data.expectedDirectory &&
              data.expectedDirectory !== data.executionDirectory
            ? {
                executionDirectory: data.executionDirectory,
                expectedDirectory: data.expectedDirectory,
              }
            : null
      }
      lastError={data.lastError}
      getPosition={getNodePosition}
      width={data.width}
      height={data.height}
      terminalFontSize={terminalFontSize}
      terminalFontFamily={terminalFontFamily}
      terminalDisplayCalibration={terminalDisplayCalibration}
      scrollback={scrollback}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onCopyLastMessage={
        data.kind === 'agent' && data.agent && typeof data.startedAt === 'string'
          ? async () => {
              await copyAgentLastMessageRef.current(id)
            }
          : undefined
      }
      onReloadSession={
        data.kind === 'agent' && data.agent
          ? async () => {
              await reloadAgentSessionRef.current(id)
            }
          : undefined
      }
      onListSessions={
        data.kind === 'agent' && data.agent
          ? async limit => {
              return await listAgentSessionsRef.current(id, limit)
            }
          : undefined
      }
      onSwitchSession={
        data.kind === 'agent' && data.agent
          ? async summary => {
              await switchAgentSessionRef.current(id, summary)
            }
          : undefined
      }
      onResize={frame => resizeNodeRef.current(id, frame)}
      onScrollbackChange={
        data.kind === 'terminal'
          ? nextScrollback => updateNodeScrollbackRef.current(id, nextScrollback)
          : undefined
      }
      onCommandRun={
        data.kind === 'terminal'
          ? command => {
              updateTerminalTitleRef.current(id, command)
            }
          : undefined
      }
      onTitleCommit={
        data.kind === 'terminal' || data.kind === 'agent'
          ? nextTitle => {
              renameTerminalTitleRef.current(id, nextTitle)
            }
          : undefined
      }
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}

export const WorkspaceCanvasTerminalNodeType = React.memo(WorkspaceCanvasTerminalNodeTypeComponent)
