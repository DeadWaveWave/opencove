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
        shouldIgnoreActivity({
          incoming: activity,
          previous: previousActivity,
        })
      ) {
        return node
      }

      const resumeSessionId = normalizeResumeSessionId(event.resumeSessionId)
      const piSnapshotAuthority =
        activity.provider === 'pi' && activity.identityAuthority === 'provider_session_snapshot'
      const clearBinding = piSnapshotAuthority && resumeSessionId === null
      const canBind =
        (activity.identityAuthority === 'provider_session_start' || piSnapshotAuthority) &&
        resumeSessionId !== null
      const isSameInvocation =
        previousActivity?.generation === activity.generation &&
        previousActivity.invocationId === activity.invocationId
      const verifiedProviderSessionId = isSameInvocation
        ? (previousActivity.verifiedProviderSessionId ?? null)
        : null
      const canAdoptBinding =
        canBind &&
        (piSnapshotAuthority ||
          verifiedProviderSessionId === null ||
          verifiedProviderSessionId === resumeSessionId)
      const nextBinding = clearBinding
        ? null
        : canAdoptBinding
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
          ...(activity.sourceRevision === undefined
            ? {}
            : { sourceRevision: activity.sourceRevision, revision: activity.revision }),
          verifiedProviderSessionId: clearBinding
            ? null
            : canAdoptBinding
              ? resumeSessionId
              : verifiedProviderSessionId,
        },
      }
      const bindingChanged =
        (canAdoptBinding || clearBinding) &&
        (node.data.terminalAgentBinding?.provider !== nextBinding?.provider ||
          node.data.terminalAgentBinding?.resumeSessionId !== nextBinding?.resumeSessionId ||
          node.data.terminalAgentBinding?.resumeSessionIdVerified !==
            nextBinding?.resumeSessionIdVerified)
      const overlayChanged =
        node.data.agentOverlay?.provider !== nextOverlay.provider ||
        node.data.agentOverlay?.status !== nextOverlay.status ||
        node.data.agentOverlay?.startedAtMs !== nextOverlay.startedAtMs ||
        previousActivity?.invocationId !== nextOverlay.activity.invocationId ||
        previousActivity?.generation !== nextOverlay.activity.generation ||
        previousActivity?.phase !== nextOverlay.activity.phase ||
        previousActivity?.observedAtMs !== nextOverlay.activity.observedAtMs ||
        previousActivity?.sourceRevision !== nextOverlay.activity.sourceRevision ||
        previousActivity?.revision !== nextOverlay.activity.revision
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
          agentRuntimeObservation:
            activity.phase === 'exited' || (previousActivity && !isSameInvocation)
              ? null
              : (node.data.agentRuntimeObservation ?? null),
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

function shouldIgnoreActivity({
  incoming,
  previous,
}: {
  incoming: ActivityMetadataEvent['terminalAgentActivity']
  previous: NonNullable<
    NonNullable<WorkspaceState['nodes'][number]['data']['agentOverlay']>['activity']
  >
}): boolean {
  if (incoming.generation < previous.generation) {
    return true
  }
  if (incoming.generation > previous.generation) {
    return false
  }
  if (incoming.invocationId !== previous.invocationId || previous.phase === 'exited') {
    return true
  }

  if (previous.revision !== undefined) {
    return incoming.revision === undefined || incoming.revision <= previous.revision
  }
  if (incoming.revision !== undefined) {
    return false
  }
  return incoming.observedAtMs < previous.observedAtMs
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
