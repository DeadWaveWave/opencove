import { useWorkspaceCanvasAgentLauncher } from './useAgentLauncher'
import { useWorkspaceCanvasAgentNodeLifecycle } from './useAgentNodeLifecycle'
import { useTerminalAgentSessionActions } from './useTerminalAgentSessionActions'

export function useWorkspaceCanvasAgentSupport({
  nodesRef,
  setNodes,
  bumpAgentLaunchToken,
  isAgentLaunchTokenCurrent,
  agentSettings,
  workspaceId,
  workspacePath,
  environmentVariables,
  spacesRef,
  updateCanvasDocument,
  onRequestPersistFlush,
  onShowMessage,
  createNodeForSession,
  standardWindowSizeBucket,
  terminalDisplayMetrics,
}: {
  nodesRef: Parameters<typeof useTerminalAgentSessionActions>[0]['nodesRef']
  setNodes: Parameters<typeof useWorkspaceCanvasAgentNodeLifecycle>[0]['setNodes']
  bumpAgentLaunchToken: Parameters<
    typeof useWorkspaceCanvasAgentNodeLifecycle
  >[0]['bumpAgentLaunchToken']
  isAgentLaunchTokenCurrent: Parameters<
    typeof useWorkspaceCanvasAgentNodeLifecycle
  >[0]['isAgentLaunchTokenCurrent']
  agentSettings: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['agentSettings']
  workspaceId: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['workspaceId']
  workspacePath: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['workspacePath']
  environmentVariables?: Record<string, string>
  spacesRef: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['spacesRef']
  updateCanvasDocument: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['updateCanvasDocument']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['onRequestPersistFlush']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['onShowMessage']
  createNodeForSession: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['createNodeForSession']
  standardWindowSizeBucket: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['standardWindowSizeBucket']
  terminalDisplayMetrics: Parameters<
    typeof useWorkspaceCanvasAgentNodeLifecycle
  >[0]['terminalDisplayMetrics']
}): ReturnType<typeof useWorkspaceCanvasAgentNodeLifecycle> &
  Pick<
    ReturnType<typeof useWorkspaceCanvasAgentLauncher>,
    'openAgentLauncher' | 'openAgentLauncherForProvider' | 'launchAgentAtFlowPosition'
  > {
  const lifecycle = useWorkspaceCanvasAgentNodeLifecycle({
    workspaceId,
    workspacePath,
    setNodes,
    bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    agentFullAccess: agentSettings.agentFullAccess,
    codexReuseRunningAppServer: agentSettings.codexReuseRunningAppServer,
    defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
    terminalFontSize: agentSettings.terminalFontSize,
    terminalDisplayMetrics,
    agentEnvByProvider: agentSettings.agentEnvByProvider,
    agentExecutablePathOverrideByProvider: agentSettings.agentExecutablePathOverrideByProvider,
    environmentVariables,
  })
  const overlayActions = useTerminalAgentSessionActions({
    nodesRef,
    setNodes,
    onRequestPersistFlush,
    onShowMessage,
  })
  const { buildAgentNodeTitle, launchAgentInNode, stopAgentNode } = lifecycle

  const { openAgentLauncher, openAgentLauncherForProvider, launchAgentAtFlowPosition } =
    useWorkspaceCanvasAgentLauncher({
      agentSettings,
      workspaceId,
      workspacePath,
      environmentVariables,
      spacesRef,
      updateCanvasDocument,
      onRequestPersistFlush,
      onShowMessage,
      createNodeForSession,
      standardWindowSizeBucket,
      buildAgentNodeTitle,
    })

  return {
    buildAgentNodeTitle,
    launchAgentInNode,
    reloadAgentNode: async nodeId => {
      if (!(await overlayActions.reloadOverlayAgent(nodeId))) {
        await lifecycle.reloadAgentNode(nodeId)
      }
    },
    listAgentSessionsForNode: async (nodeId, limit) => {
      const sessions = await overlayActions.listOverlayAgentSessions(nodeId, limit)
      return sessions ?? (await lifecycle.listAgentSessionsForNode(nodeId, limit))
    },
    switchAgentNodeSession: async (nodeId, summary) => {
      if (!(await overlayActions.switchOverlayAgentSession(nodeId, summary))) {
        await lifecycle.switchAgentNodeSession(nodeId, summary)
      }
    },
    stopAgentNode,
    openAgentLauncher,
    openAgentLauncherForProvider,
    launchAgentAtFlowPosition,
  }
}
