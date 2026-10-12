import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createRuntimeDeps } from '../../../src/app/main/controlSurface/handlers/nodeControlRuntime'
import { createNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { SpaceLocatorResolverDeps } from '../../../src/contexts/workspace/application/nodeControl/spaceLocator'

describe('node control agent session binding', () => {
  it.each(['claude-code', 'codex'] as const)(
    'writes only authoritative new %s launch identity into the durable node',
    async provider => {
      const state = createMinimalState('/repo', 'project', 'space')
      const store: NodeControlAppStateStore = {
        readAppState: async () => state,
        readAppStateRevision: async () => 1,
        writeAppState: vi.fn(async () => ({ ok: true, level: 'full', bytes: 1, revision: 2 })),
      }
      const locatorDeps: SpaceLocatorResolverDeps = {
        listMounts: async () => [],
        listEndpoints: async () => [
          {
            endpointId: 'local',
            kind: 'local',
            displayName: 'Local',
            createdAt: '',
            updatedAt: '',
            remote: null,
          },
        ],
        listWorktreesForMount: async () => [],
        listWorktreesForWorkspace: async () => [],
      }
      const controlSurface = createControlSurface()
      controlSurface.register('session.launchAgent', {
        kind: 'command',
        validate: payload => payload,
        handle: async () => ({
          sessionId: 'runtime-a',
          provider,
          resumeSessionId: 'assigned-a',
          effectiveModel: null,
          executionContext: { workingDirectory: '/repo' },
          startedAt: '2026-10-12T00:00:00Z',
          profileId: null,
          runtimeKind: 'posix',
        }),
      })
      const runtime = createRuntimeDeps(controlSurface, { now: () => new Date() }, undefined)
      await createNodeForNodeControl({
        store,
        locatorDeps,
        runtime,
        input: {
          kind: 'agent',
          space: { kind: 'spaceId', spaceId: 'space' },
          data: { provider, prompt: '' },
        },
        now: new Date(),
      })
      expect(store.writeAppState).toHaveBeenCalledOnce()
      const written = vi.mocked(store.writeAppState).mock.calls[0][0]
      expect(written.workspaces[0].nodes[0].agent).toMatchObject({
        resumeSessionId: provider === 'claude-code' ? 'assigned-a' : null,
        resumeSessionIdVerified: provider === 'claude-code',
      })
    },
  )
})
