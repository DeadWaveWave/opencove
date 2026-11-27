import React, { useCallback, type ReactElement } from 'react'
import { useStore, useStoreApi, type Node } from '@xyflow/react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { LabelColor } from '@shared/types/labelColor'
import { TerminalNode } from '../TerminalNode'
import { WorkspaceDocumentNavigationContext } from './WorkspaceDocumentNavigationContext'
import { useScrollbackStore } from '../../store/useScrollbackStore'
import type { TerminalNodeData } from '../../types'
import { isResumeSessionBindingVerified } from '../../utils/agentResumeBinding'
import { resolveAgentPresentation } from '../../utils/agentPresentation'
import { findLinkedTaskTitleForAgent, resolveAgentDisplayLabel } from '../../utils/agentTitle'
import { readNodePositionFromStoreState } from './nodePosition'
import { useCanvasNodeCommands } from './nodeTypes.context'

function WorkspaceCanvasTerminalNodeTypeComponent({
  data,
  id,
  selected,
  dragging,
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
  terminalTransparentBackground,
}: {
  data: TerminalNodeData
  id: string
  selected?: boolean
  dragging?: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  terminalTransparentBackground: boolean
}): ReactElement {
  const documentNavigation = React.useContext(WorkspaceDocumentNavigationContext)
  const commands = useCanvasNodeCommands()
  const windowCommands = commands.window
  const terminalCommands = commands.terminal
  const storeApi = useStoreApi()
  const scrollback = useScrollbackStore(state =>
    data.kind === 'agent' ? null : (state.scrollbackByNodeId[id] ?? data.scrollback ?? null),
  )
  const getNodePosition = useCallback(() => {
    return readNodePositionFromStoreState(storeApi.getState(), id)
  }, [id, storeApi])
  const overlayStartedAtMs =
    data.kind === 'terminal' && data.agentOverlay ? data.agentOverlay.startedAtMs : null
  const gatewayOwnsOverlayLifecycle =
    Boolean(data.agentOverlay?.activity) ||
    Boolean(data.terminalAgentBinding && isResumeSessionBindingVerified(data.terminalAgentBinding))
  const handleAgentOverlayExit = useCallback(() => {
    if (overlayStartedAtMs === null || gatewayOwnsOverlayLifecycle) {
      return
    }
    terminalCommands.clearAgentOverlay(id, overlayStartedAtMs)
  }, [gatewayOwnsOverlayLifecycle, id, overlayStartedAtMs, terminalCommands])
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null
  const presentation = resolveAgentPresentation(data)
  const isAgentTreated = presentation.isAgent
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
  const titleProvider = data.kind === 'agent' ? (data.agent?.provider ?? null) : overlayProvider
  const resolvedTitle = titleProvider
    ? resolveAgentDisplayLabel({
        provider: titleProvider,
        linkedTaskTitle,
        fallbackTitle: data.title,
        preferFallbackTitle: data.titlePinnedByUser === true,
        titleIsLiteral: data.titleIsLiteral === true,
      })
    : data.title
  const executionDirectory =
    data.kind === 'agent'
      ? (data.agent?.executionDirectory ?? null)
      : (data.executionDirectory ?? null)

  return (
    <TerminalNode
      nodeId={id}
      sessionId={data.sessionId}
      workerBinding={data.workerBinding}
      executionDirectory={executionDirectory}
      onOpenFileLink={request =>
        documentNavigation?.openFileLink(id, request) ?? Promise.resolve(false)
      }
      title={resolvedTitle}
      kind={data.kind}
      isAgentPresentation={isAgentTreated}
      labelColor={labelColor}
      agentLaunchMode={data.kind === 'agent' ? (data.agent?.launchMode ?? null) : null}
      agentExecutionDirectory={executionDirectory}
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
      status={presentation.status}
      agentStateSource={presentation.observation?.source ?? null}
      agentHookInstallState={presentation.observation?.hookInstallState ?? null}
      blockedReason={presentation.observation?.blockedReason}
      agentStateDegraded={presentation.observation?.degraded === true}
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
      terminalTransparentBackground={terminalTransparentBackground}
      scrollback={scrollback}
      onClose={() => {
        void windowCommands.close(id)
      }}
      onCopyLastMessage={
        isAgentTreated
          ? async () => {
              await terminalCommands.copyLastAgentMessage(id)
            }
          : undefined
      }
      onReloadSession={
        isAgentTreated
          ? async () => {
              await terminalCommands.reloadAgentSession(id)
            }
          : undefined
      }
      onListSessions={
        isAgentTreated
          ? async limit => {
              return await terminalCommands.listAgentSessions(id, limit)
            }
          : undefined
      }
      onSwitchSession={
        isAgentTreated
          ? async summary => {
              await terminalCommands.switchAgentSession(id, summary)
            }
          : undefined
      }
      onResize={frame => windowCommands.resize(id, frame)}
      onScrollbackChange={
        data.kind === 'terminal'
          ? nextScrollback => terminalCommands.updateScrollback(id, nextScrollback)
          : undefined
      }
      onCommandRun={
        data.kind === 'terminal'
          ? (command, startedAtMs) => {
              terminalCommands.recordCommandRun(id, command, startedAtMs)
            }
          : undefined
      }
      onAgentOverlayExit={overlayStartedAtMs === null ? undefined : handleAgentOverlayExit}
      onTitleCommit={
        data.kind === 'terminal' || data.kind === 'agent'
          ? nextTitle => {
              terminalCommands.renameTitle(id, nextTitle)
            }
          : undefined
      }
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            windowCommands.select(id, { toggle: true })
            return
          }

          windowCommands.select(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        windowCommands.focusForInteraction(id)
      }}
    />
  )
}

export const WorkspaceCanvasTerminalNodeType = React.memo(WorkspaceCanvasTerminalNodeTypeComponent)
