import type { ServerResponse } from 'node:http'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { SyncEventPayload } from './http/syncSse'
import { createCommittedStatePublisher } from './http/committedStatePublisher'
import { createManagedClaudeLaunchRuntime } from './managedClaudeLaunchRuntime'
import { managedClaudeWritesEnabled } from './managedClaudeCompatibility'

/** Owns commit subscriptions and the buffered lifecycle delivery composition. */
export function createManagedClaudeDeliveryRuntime(input: {
  getStore(): Promise<PersistenceStore>
  killExactRuntime(id: string): Promise<void>
  hasRuntime(id: string): boolean
  desktopSink?: (payload: SyncEventPayload) => number
}) {
  const syncClients = new Set<ServerResponse>()
  const syncEventBuffer: SyncEventPayload[] = []
  const commitPublisher = createCommittedStatePublisher({
    ...input,
    syncClients,
    buffer: syncEventBuffer,
  })
  const managedClaude = createManagedClaudeLaunchRuntime({
    getPersistenceStore: commitPublisher.getStore,
    killExactRuntime: input.killExactRuntime,
    hasRuntime: input.hasRuntime,
    adoptionEnabled: () =>
      managedClaudeWritesEnabled() &&
      process.env.OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS === '1',
    writesEnabled: managedClaudeWritesEnabled,
    publishCommittedActivation: event =>
      commitPublisher.publish({ ...event, operationId: 'session.managedClaudeActivation' }),
  })
  return {
    syncClients,
    syncEventBuffer,
    commitPublisher,
    managedClaude,
    getPersistenceStore: commitPublisher.getStore,
  }
}
