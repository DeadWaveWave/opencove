import {
  assertManagedClaudeMutationAllowed,
  managedClaudeWritesEnabled,
} from './managedClaudeCompatibility'
import type { ControlSurfaceContext } from './types'
import type { ControlSurfaceInvokeRequest } from '../../../shared/contracts/controlSurface'
import type { LaunchAgentSessionInput } from '../../../shared/contracts/dto'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { TerminalRuntimeAvailability } from '../../../contexts/terminal/application/TerminalRuntimeAvailability'
import type { createManagedClaudeLaunchRuntime } from './managedClaudeLaunchRuntime'
import { canvasSpawnIdentity, canvasSpawnOperations } from './sessionSpawnIdentityContext'
import { resolveCanvasSpawnIdentity } from './resolveCanvasSpawnIdentity'

export function createCanvasSpawnRunner(deps: {
  managedClaude: ReturnType<typeof createManagedClaudeLaunchRuntime>
  terminalRuntimeAvailability: Pick<TerminalRuntimeAvailability, 'assertSpawnAllowed'>
  getPersistenceStore(): Promise<PersistenceStore>
  resolveIdentity?: typeof resolveCanvasSpawnIdentity
}) {
  return async (
    context: ControlSurfaceContext,
    request: ControlSurfaceInvokeRequest,
    execute: (context?: ControlSurfaceContext) => Promise<unknown>,
    payload: unknown,
  ): Promise<unknown> => {
    if (request.id === 'session.prepareOrRevive') {
      const input = payload as { workspaceId: string; nodeIds?: string[] }
      await deps.managedClaude.ready()
      context.assertActive?.()
      const attempts = await deps.managedClaude.reservePreparation(
        context,
        input.workspaceId,
        input.nodeIds,
      )
      context.assertActive?.()
      return execute({
        ...context,
        managedClaudePreparation: {
          awaitPending: deps.managedClaude.awaitPending,
          reserve: id => {
            assertManagedClaudeMutationAllowed(context, id, managedClaudeWritesEnabled())
            return deps.managedClaude.owner.reservations.resume(id, context.assertActive)
          },
          attempts,
          run: deps.managedClaude.withPreparation,
        },
      })
    }
    if (!canvasSpawnOperations.has(request.id)) {
      return await execute()
    }
    // Direct PTY spawn admission must precede identity's persistence read, just as
    // it precedes persistence-dependent work in the handler.
    if (request.id === 'pty.spawn') {
      const spawnPayload = request.payload as { workspaceId?: unknown }
      deps.terminalRuntimeAvailability.assertSpawnAllowed(
        typeof spawnPayload.workspaceId === 'string'
          ? spawnPayload.workspaceId.trim() || null
          : null,
        context.terminalRecoverySpawnScope,
      )
    }
    let resolvedIdentity = canvasSpawnIdentity.getStore()
    const resolveIdentity = async () =>
      resolvedIdentity ??
      (resolvedIdentity = await (deps.resolveIdentity ?? resolveCanvasSpawnIdentity)(
        context,
        request.payload,
        deps.getPersistenceStore,
      ))
    const launch =
      request.id === 'session.launchAgent' || request.id === 'session.launchAgentInMount'
    if (launch) {
      return deps.managedClaude.run(
        context,
        request.payload,
        payload as LaunchAgentSessionInput,
        resolveIdentity,
        async admitted => {
          const identity = await resolveIdentity()
          admitted.assertActive?.()
          return identity
            ? canvasSpawnIdentity.run(identity, () => execute(admitted))
            : execute(admitted)
        },
      )
    }
    const identity = await resolveIdentity()
    context.assertActive?.()
    return identity ? await canvasSpawnIdentity.run(identity, () => execute()) : await execute()
  }
}
