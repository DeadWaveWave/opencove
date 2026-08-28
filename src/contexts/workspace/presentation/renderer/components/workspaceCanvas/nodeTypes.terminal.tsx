import React, { useCallback, type MutableRefObject, type ReactElement } from 'react'
import { useStore, useStoreApi, type Node } from '@xyflow/react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { LabelColor } from '@shared/types/labelColor'
import { TerminalNode } from '../TerminalNode'
import { useScrollbackStore } from '../../store/useScrollbackStore'
import type { NodeFrame, TerminalNodeData } from '../../types'
import { isResumeSessionBindingVerified } from '../../utils/agentResumeBinding'
import { isAgentTreatedNode } from '../../utils/terminalAgentOverlay'
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
  clearTerminalAgentOverlayRef,
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
  updateTerminalTitleRef: MutableRefObject<
    (nodeId: string, title: string, startedAtMs?: number) => void
  >
  clearTerminalAgentOverlayRef: MutableRefObject<
    (nodeId: string, expectedStartedAtMs?: number) => void
  >
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}): ReactElement {
  const storeApi = useStoreApi()
  const scrollback = useScrollbackStore(state =>
    data.kind === 'agent' ? null : (state.scrollbackByNodeId[id] ?? data.scrollback ?? null),
  )
  const getNodePosition = useCallback(() => {
    return readNodePositionFromStoreState(storeApi.getState(), id)
  }, [id, storeApi])
  const overlayStartedAtMs =
    data.kind === 'terminal' && data.agentOverlay ? data.agentOverlay.startedAtMs : null
  const gatewayOwnsOverlayLifecycle = Boolean(data.agentOverlay?.activity)
  const handleAgentOverlayExit = useCallback(() => {
    if (overlayStartedAtMs === null || gatewayOwnsOverlayLifecycle) {
      return
    }
    clearTerminalAgentOverlayRef.current(id, overlayStartedAtMs)
  }, [clearTerminalAgentOverlayRef, gatewayOwnsOverlayLifecycle, id, overlayStartedAtMs])
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null
  const isAgentTreated = isAgentTreatedNode({ data })
  const liveOverlayProvider =
    data.agentOverlay?.activity?.phase === 'exited' ? null : (data.agentOverlay?.provider ?? null)
  const resolvedTerminalProvider =
    data.kind === 'agent'
      ? (data.agent?.provider ?? null)
      : (liveOverlayProvider ??
        data.terminalAgentBinding?.provider ??
        data.terminalProviderHint ??
        null)
  const overlayProvider =
    data.kind === 'terminal' && isAgentTreated
      ? (liveOverlayProvider ?? data.terminalAgentBinding?.provider ?? null)
      : null
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
          : overlayProvider
            ? `${providerTitlePrefix(overlayProvider)} · `
            : null
      }
      kind={data.kind}
      labelColor={labelColor}
      agentLaunchMode={data.kind === 'agent' ? (data.agent?.launchMode ?? null) : null}
      agentExecutionDirectory={
        data.kind === 'agent'
          ? (data.agent?.executionDirectory ?? null)
          : (data.executionDirectory ?? null)
      }
      agentResumeSessionId={
        data.kind === 'agent'
          ? (data.agent?.resumeSessionId ?? null)
          : (data.terminalAgentBinding?.resumeSessionId ?? null)
      }
      agentResumeSessionIdVerified={
        data.kind === 'agent' && data.agent
          ? isResumeSessionBindingVerified(data.agent)
          : data.terminalAgentBinding
            ? isResumeSessionBindingVerified(data.terminalAgentBinding)
            : false
      }
      terminalProvider={resolvedTerminalProvider}
      isLiveSessionReattach={data.isLiveSessionReattach === true}
      autoFocus={data.autoFocus === true}
      terminalGeometry={data.terminalGeometry ?? null}
      terminalThemeMode="sync-with-ui"
      isSelected={selected === true}
      isDragging={dragging === true}
      status={data.agentRuntimeObservation?.status ?? data.agentOverlay?.status ?? data.status}
      agentStateSource={data.agentRuntimeObservation?.source ?? null}
      agentHookInstallState={data.agentRuntimeObservation?.hookInstallState ?? null}
      agentStateDegraded={data.agentRuntimeObservation?.degraded === true}
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
      recoveryIssue={data.recoveryIssue ?? null}
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
        isAgentTreated
          ? async () => {
              await copyAgentLastMessageRef.current(id)
            }
          : undefined
      }
      onReloadSession={
        isAgentTreated
          ? async () => {
              await reloadAgentSessionRef.current(id)
            }
          : undefined
      }
      onListSessions={
        isAgentTreated
          ? async limit => {
              return await listAgentSessionsRef.current(id, limit)
            }
          : undefined
      }
      onSwitchSession={
        isAgentTreated
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
          ? (command, startedAtMs) => {
              updateTerminalTitleRef.current(id, command, startedAtMs)
            }
          : undefined
      }
      onAgentOverlayExit={overlayStartedAtMs === null ? undefined : handleAgentOverlayExit}
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
