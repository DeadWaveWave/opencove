import { createAppError } from '../../../../shared/errors/appError'
import {
  requireNodeControlState,
  type NodeControlAppState,
  type NodeControlAppStateStore,
} from './nodeControlState'

export type NodeMutationAuthority = { projectId: string; nodeId: string | null }

/** Only a definite CAS conflict permits replay of the read-only plan, never an unknown outcome. */
export async function commitNodeMutation<T>(options: {
  store: NodeControlAppStateStore
  assertActive?: () => void
  plan: (
    state: NodeControlAppState,
  ) => { state: NodeControlAppState; value: T } | Promise<{ state: NodeControlAppState; value: T }>
}): Promise<T & { revision: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    options.assertActive?.()
    // eslint-disable-next-line no-await-in-loop
    const expectedRevision = await options.store.readAppStateRevision()
    // eslint-disable-next-line no-await-in-loop
    const state = requireNodeControlState(await options.store.readAppState())
    // eslint-disable-next-line no-await-in-loop -- Authorization may read immutable lineage before committing this snapshot.
    const plan = await options.plan(state)
    options.assertActive?.()
    // eslint-disable-next-line no-await-in-loop
    const result = await options.store.writeAppState(plan.state, { expectedRevision })
    if (result.ok) {
      // eslint-disable-next-line no-await-in-loop -- Preserve the existing store revision fallback.
      const revision = result.revision ?? (await options.store.readAppStateRevision())
      return {
        ...plan.value,
        revision,
      }
    }
    if (!isNodeRevisionConflict(result.error) || attempt === 2) {
      throw createAppError(result.error)
    }
  }
  throw new Error('Node mutation persistence attempts exhausted.')
}

export function isNodeRevisionConflict(error: { code: string; debugMessage?: string }): boolean {
  return (
    error.code === 'persistence.invalid_state' &&
    /^App state revision conflict(?:\s|\(|$)/.test(error.debugMessage ?? '')
  )
}

export function nodePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function assertMutationProject(projectId: string, authority?: NodeMutationAuthority): void {
  if (authority && authority.projectId !== projectId) {
    throw createAppError('common.forbidden', {
      debugMessage: 'Choose a node in your project.',
      details: { reason: 'project_mismatch' },
    })
  }
}
