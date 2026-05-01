import type { Node } from '@xyflow/react'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { LaunchAgentSessionResult, TerminalRuntimeKind } from '@shared/contracts/dto'
import { resolveTerminalPtyGeometryForNodeFrame } from '@contexts/workspace/domain/terminalPtyGeometry'
import type { AgentNodeData, TerminalNodeData } from '../../../types'

export type AgentRuntimeNode = Node<TerminalNodeData> & {
  data: TerminalNodeData & {
    kind: 'agent'
    agent: AgentNodeData
  }
}

export interface RelaunchAgentNodeOptions {
  nodeId: string
  mode: 'new' | 'resume'
  executionDirectory?: string
  expectedDirectory?: string | null
  resumeSessionId?: string | null
  startedAtOverride?: string
}

export interface AgentRuntimeLaunchResult {
  sessionId: string
  profileId: string | null | undefined
  runtimeKind: TerminalRuntimeKind | undefined
  effectiveModel: string | null
  resumeSessionId: string | null
  startedAt: string
  executionDirectory: string
  terminalGeometry: { cols: number; rows: number }
}

export function findAgentNode(
  nodeId: string,
  nodes: Node<TerminalNodeData>[],
): AgentRuntimeNode | null {
  const node = nodes.find(item => item.id === nodeId)
  if (!node || node.data.kind !== 'agent' || !node.data.agent) {
    return null
  }

  return node as AgentRuntimeNode
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export async function launchAgentRuntime({
  node,
  mountId,
  mergedEnv,
  mode,
  executionDirectory,
  resumeSessionId,
  agentFullAccess,
  defaultTerminalProfileId,
  executablePathOverride,
  terminalFontSize,
}: {
  node: AgentRuntimeNode
  mountId: string | null
  mergedEnv: Record<string, string>
  mode: 'new' | 'resume'
  executionDirectory: string
  resumeSessionId: string | null
  agentFullAccess: boolean
  defaultTerminalProfileId: string | null
  executablePathOverride: string | null
  terminalFontSize: number
}): Promise<AgentRuntimeLaunchResult> {
  const launchGeometry = resolveTerminalPtyGeometryForNodeFrame({
    width: node.data.width,
    height: node.data.height,
    terminalFontSize,
  })

  if (mountId) {
    const cwd = executionDirectory.trim()
    const cwdUri = cwd.length > 0 ? toFileUri(cwd) : null
    const launched = await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        mountId,
        cwdUri,
        prompt: node.data.agent.prompt,
        provider: node.data.agent.provider,
        mode,
        model: node.data.agent.model,
        resumeSessionId: mode === 'resume' ? resumeSessionId : null,
        ...(executablePathOverride ? { executablePathOverride } : {}),
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
        agentFullAccess,
        cols: launchGeometry.cols,
        rows: launchGeometry.rows,
      },
    })

    return {
      sessionId: launched.sessionId,
      profileId: launched.profileId,
      runtimeKind: launched.runtimeKind ?? undefined,
      effectiveModel: launched.effectiveModel,
      resumeSessionId: launched.resumeSessionId ?? resumeSessionId,
      startedAt: launched.startedAt,
      executionDirectory: launched.executionContext.workingDirectory,
      terminalGeometry: launchGeometry,
    }
  }

  const launched = await window.opencoveApi.agent.launch({
    provider: node.data.agent.provider,
    cwd: executionDirectory,
    profileId: node.data.profileId ?? defaultTerminalProfileId,
    prompt: node.data.agent.prompt,
    mode,
    model: node.data.agent.model,
    resumeSessionId: mode === 'resume' ? resumeSessionId : null,
    ...(executablePathOverride ? { executablePathOverride } : {}),
    ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
    agentFullAccess,
    cols: launchGeometry.cols,
    rows: launchGeometry.rows,
  })

  return {
    sessionId: launched.sessionId,
    profileId: launched.profileId,
    runtimeKind: launched.runtimeKind,
    effectiveModel: launched.effectiveModel,
    resumeSessionId: launched.resumeSessionId ?? null,
    startedAt: new Date().toISOString(),
    executionDirectory,
    terminalGeometry: launchGeometry,
  }
}
