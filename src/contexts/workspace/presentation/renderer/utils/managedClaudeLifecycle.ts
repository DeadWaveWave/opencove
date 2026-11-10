import type { GetNodeResult } from '@shared/contracts/dto'
import type { ManagedClaudeBindingObservation } from '@shared/contracts/managedClaudeLaunch'

/** Query durable ownership at interaction start; never infer it from renderer metadata. */
export async function readManagedClaudeBinding(
  nodeId: string,
  provider?: string,
): Promise<ManagedClaudeBindingObservation | null> {
  if (provider !== 'claude-code' || !window.opencoveApi?.controlSurface?.invoke) {
    return null
  }
  const result = await window.opencoveApi.controlSurface.invoke<GetNodeResult>({
    kind: 'query',
    id: 'node.get',
    payload: { nodeId },
  })
  return result?.managedClaudeBinding ?? null
}

export async function killUnownedNodeRuntime(node: {
  id: string
  data: { kind?: string; sessionId: string; agent?: { provider: string } | null }
}): Promise<void> {
  if (!node.data.sessionId) {
    return
  }
  if (node.data.agent?.provider !== 'claude-code' || !window.opencoveApi?.controlSurface?.invoke) {
    await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
    return
  }
  // A failed ownership read cannot authorize speculative deletion cleanup.
  const binding = await readManagedClaudeBinding(node.id, node.data.agent?.provider)
  if (!binding) {
    await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
  }
}

/** Task reuse needs the saved directory before it can persist any display/relationship edits. */
export async function readManagedClaudeExecutionContext(
  nodeId: string,
  provider?: string,
): Promise<{ binding: ManagedClaudeBindingObservation; executionDirectory: string | null } | null> {
  if (provider !== 'claude-code' || !window.opencoveApi?.controlSurface?.invoke) {
    return null
  }
  const result = await window.opencoveApi.controlSurface.invoke<GetNodeResult>({
    kind: 'query',
    id: 'node.get',
    payload: { nodeId },
  })
  if (!result?.managedClaudeBinding) {
    return null
  }
  return {
    binding: result.managedClaudeBinding,
    executionDirectory:
      result.node.data.kind === 'agent' ? result.node.data.executionDirectory : null,
  }
}
