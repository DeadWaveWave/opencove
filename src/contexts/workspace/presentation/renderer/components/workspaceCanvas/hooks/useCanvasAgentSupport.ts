import { useCallback } from 'react'
import { useWorkspaceCanvasAgentLauncher } from './useAgentLauncher'
import { useWorkspaceCanvasAgentNodeLifecycle } from './useAgentNodeLifecycle'
import { useTerminalAgentSessionActions } from './useTerminalAgentSessionActions'

export function useWorkspaceCanvasAgentSupport({
  bumpAgentLaunchToken,
  isAgentLaunchTokenCurrent,
  readAgentSettings,
  readTerminalDisplayCalibration,
  workspaceId,
  workspacePath,
  environmentVariables,
  updateCanvasDocument,
  onShowMessage,
  createNodeForSession,
}: {
  bumpAgentLaunchToken: Parameters<
    typeof useWorkspaceCanvasAgentNodeLifecycle
  >[0]['bumpAgentLaunchToken']
  isAgentLaunchTokenCurrent: Parameters<
    typeof useWorkspaceCanvasAgentNodeLifecycle
  >[0]['isAgentLaunchTokenCurrent']
  readAgentSettings: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['readAgentSettings']
  readTerminalDisplayCalibration: Parameters<
    typeof useWorkspaceCanvasAgentNodeLifecycle
  >[0]['readTerminalDisplayCalibration']
  workspaceId: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['workspaceId']
  workspacePath: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['workspacePath']
  environmentVariables?: Record<string, string>
  updateCanvasDocument: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['updateCanvasDocument']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['onShowMessage']
  createNodeForSession: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['createNodeForSession']
}): ReturnType<typeof useWorkspaceCanvasAgentNodeLifecycle> &
  Pick<
    ReturnType<typeof useWorkspaceCanvasAgentLauncher>,
    'openAgentLauncher' | 'openAgentLauncherForProvider' | 'launchAgentAtFlowPosition'
  > {
  const lifecycle = useWorkspaceCanvasAgentNodeLifecycle({
    workspaceId,
    workspacePath,
    bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    readAgentSettings,
    readTerminalDisplayCalibration,
    environmentVariables,
  })
  const overlayActions = useTerminalAgentSessionActions({ onShowMessage })
  const {
    buildAgentNodeTitle,
    launchAgentInNode,
    stopAgentNode,
    reloadAgentNode: reloadLifecycleAgent,
    listAgentSessionsForNode: listLifecycleAgentSessions,
    switchAgentNodeSession: switchLifecycleAgentSession,
  } = lifecycle
  const { reloadOverlayAgent, listOverlayAgentSessions, switchOverlayAgentSession } = overlayActions

  const { openAgentLauncher, openAgentLauncherForProvider, launchAgentAtFlowPosition } =
    useWorkspaceCanvasAgentLauncher({
      readAgentSettings,
      workspaceId,
      workspacePath,
      environmentVariables,
      updateCanvasDocument,
      onShowMessage,
      createNodeForSession,
      buildAgentNodeTitle,
    })

  // Each is one function for as long as its parts are, so the terminal commands built from them
  // keep their identity across renders.
  const reloadAgentNode = useCallback(
    async (nodeId: string) => {
      if (!(await reloadOverlayAgent(nodeId))) {
        await reloadLifecycleAgent(nodeId)
      }
    },
    [reloadLifecycleAgent, reloadOverlayAgent],
  )
  const listAgentSessionsForNode = useCallback(
    async (nodeId: string, limit?: number) => {
      const sessions = await listOverlayAgentSessions(nodeId, limit)
      return sessions ?? (await listLifecycleAgentSessions(nodeId, limit))
    },
    [listLifecycleAgentSessions, listOverlayAgentSessions],
  )
  const switchAgentNodeSession = useCallback(
    async (nodeId: string, summary: Parameters<typeof switchLifecycleAgentSession>[1]) => {
      if (!(await switchOverlayAgentSession(nodeId, summary))) {
        await switchLifecycleAgentSession(nodeId, summary)
      }
    },
    [switchLifecycleAgentSession, switchOverlayAgentSession],
  )

  return {
    buildAgentNodeTitle,
    launchAgentInNode,
    reloadAgentNode,
    listAgentSessionsForNode,
    switchAgentNodeSession,
    stopAgentNode,
    openAgentLauncher,
    openAgentLauncherForProvider,
    launchAgentAtFlowPosition,
  }
}
