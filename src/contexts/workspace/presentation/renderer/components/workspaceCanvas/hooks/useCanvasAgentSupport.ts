import { useWorkspaceCanvasAgentLauncher } from './useAgentLauncher'
import { useWorkspaceCanvasAgentNodeLifecycle } from './useAgentNodeLifecycle'

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
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
  contextMenu,
  setContextMenu,
  createNodeForSession,
  standardWindowSizeBucket,
}: {
  nodesRef: Parameters<typeof useWorkspaceCanvasAgentNodeLifecycle>[0]['nodesRef']
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
  onSpacesChange: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['onSpacesChange']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['onRequestPersistFlush']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['onShowMessage']
  contextMenu: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['contextMenu']
  setContextMenu: Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]['setContextMenu']
  createNodeForSession: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['createNodeForSession']
  standardWindowSizeBucket: Parameters<
    typeof useWorkspaceCanvasAgentLauncher
  >[0]['standardWindowSizeBucket']
}): ReturnType<typeof useWorkspaceCanvasAgentNodeLifecycle> &
  Pick<
    ReturnType<typeof useWorkspaceCanvasAgentLauncher>,
    'openAgentLauncher' | 'openAgentLauncherForProvider'
  > {
  const {
    buildAgentNodeTitle,
    launchAgentInNode,
    reloadAgentNode,
    listAgentSessionsForNode,
    switchAgentNodeSession,
    stopAgentNode,
  } = useWorkspaceCanvasAgentNodeLifecycle({
    workspaceId,
    nodesRef,
    spacesRef,
    setNodes,
    bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    agentFullAccess: agentSettings.agentFullAccess,
    defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
    terminalFontSize: agentSettings.terminalFontSize,
    agentEnvByProvider: agentSettings.agentEnvByProvider,
    agentExecutablePathOverrideByProvider: agentSettings.agentExecutablePathOverrideByProvider,
    environmentVariables,
    onRequestPersistFlush,
  })

  const { openAgentLauncher, openAgentLauncherForProvider } = useWorkspaceCanvasAgentLauncher({
    agentSettings,
    workspaceId,
    workspacePath,
    environmentVariables,
    nodesRef,
    setNodes,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    contextMenu,
    setContextMenu,
    createNodeForSession,
    standardWindowSizeBucket,
    buildAgentNodeTitle,
  })

  return {
    buildAgentNodeTitle,
    launchAgentInNode,
    reloadAgentNode,
    listAgentSessionsForNode,
    switchAgentNodeSession,
    stopAgentNode,
    openAgentLauncher,
    openAgentLauncherForProvider,
  }
}
