import type { TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

type ActivityMetadataEvent = TerminalSessionMetadataEvent & {
  terminalAgentActivity: NonNullable<TerminalSessionMetadataEvent['terminalAgentActivity']>
}

function normalizeResumeSessionId(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function updateWorkspacesWithTerminalAgentActivityMetadata({
  workspaces,
  event,
}: {
  workspaces: WorkspaceState[]
  event: ActivityMetadataEvent
}): {
  nextWorkspaces: WorkspaceState[]
  didChange: boolean
  durableDidChange: boolean
} {
  const activity = event.terminalAgentActivity
  let didChange = false
  let durableDidChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    let workspaceDidChange = false
    const nextNodes = workspace.nodes.map(node => {
      if (node.data.kind !== 'terminal' || node.data.sessionId !== event.sessionId) {
        return node
      }

      const previousActivity = node.data.agentOverlay?.activity ?? null
      if (
        previousActivity &&
        (activity.generation < previousActivity.generation ||
          (activity.generation === previousActivity.generation &&
            (activity.invocationId !== previousActivity.invocationId ||
              activity.observedAtMs < previousActivity.observedAtMs ||
              previousActivity.phase === 'exited')))
      ) {
        return node
      }

      const resumeSessionId = normalizeResumeSessionId(event.resumeSessionId)
      const canBind =
        activity.phase === 'active' &&
        activity.identityAuthority === 'provider_session_start' &&
        resumeSessionId !== null
      const nextBinding = canBind
        ? {
            provider: activity.provider,
            resumeSessionId,
            resumeSessionIdVerified: true as const,
          }
        : (node.data.terminalAgentBinding ?? null)
      const nextOverlay = {
        provider: activity.provider,
        status: 'standby' as const,
        startedAtMs:
          previousActivity?.generation === activity.generation
            ? (node.data.agentOverlay?.startedAtMs ?? activity.observedAtMs)
            : activity.observedAtMs,
        activity: {
          invocationId: activity.invocationId,
          generation: activity.generation,
          phase: activity.phase,
          observedAtMs: activity.observedAtMs,
        },
      }
      const bindingChanged =
        canBind &&
        (node.data.terminalAgentBinding?.provider !== nextBinding?.provider ||
          node.data.terminalAgentBinding?.resumeSessionId !== nextBinding?.resumeSessionId ||
          node.data.terminalAgentBinding?.resumeSessionIdVerified !== true)
      const overlayChanged =
        node.data.agentOverlay?.provider !== nextOverlay.provider ||
        node.data.agentOverlay?.status !== nextOverlay.status ||
        node.data.agentOverlay?.startedAtMs !== nextOverlay.startedAtMs ||
        previousActivity?.invocationId !== nextOverlay.activity.invocationId ||
        previousActivity?.generation !== nextOverlay.activity.generation ||
        previousActivity?.phase !== nextOverlay.activity.phase ||
        previousActivity?.observedAtMs !== nextOverlay.activity.observedAtMs
      if (!bindingChanged && !overlayChanged) {
        return node
      }

      workspaceDidChange = true
      didChange = true
      durableDidChange ||= bindingChanged
      return {
        ...node,
        data: {
          ...node.data,
          terminalAgentBinding: nextBinding,
          agentOverlay: nextOverlay,
        },
      }
    })

    return workspaceDidChange ? { ...workspace, nodes: nextNodes } : workspace
  })

  return {
    nextWorkspaces: didChange ? nextWorkspaces : workspaces,
    didChange,
    durableDidChange,
  }
}

export function reconcileTerminalAgentActivitySnapshots({
  workspaces,
  readLatestMetadata,
}: {
  workspaces: WorkspaceState[]
  readLatestMetadata: (sessionId: string) => TerminalSessionMetadataEvent | null
}): {
  nextWorkspaces: WorkspaceState[]
  didChange: boolean
  durableDidChange: boolean
} {
  let nextWorkspaces = workspaces
  let didChange = false
  let durableDidChange = false
  const sessionIds = new Set(
    workspaces.flatMap(workspace =>
      workspace.nodes
        .filter(node => node.data.kind === 'terminal' && node.data.sessionId.trim().length > 0)
        .map(node => node.data.sessionId),
    ),
  )

  for (const sessionId of sessionIds) {
    const metadata = readLatestMetadata(sessionId)
    if (!metadata?.terminalAgentActivity) {
      continue
    }
    const result = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: nextWorkspaces,
      event: metadata as ActivityMetadataEvent,
    })
    nextWorkspaces = result.nextWorkspaces
    didChange ||= result.didChange
    durableDidChange ||= result.durableDidChange
  }

  return { nextWorkspaces, didChange, durableDidChange }
}
