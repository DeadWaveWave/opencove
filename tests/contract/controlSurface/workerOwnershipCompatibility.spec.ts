import { afterEach, expect, it, vi } from 'vitest'
import { invokeBrowserControlSurface } from '../../../src/app/renderer/browser/browserControlSurface'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'
import {
  readManagedClaudeBinding,
  lookupManagedClaudeOwnership,
} from '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeLifecycle'
import { prepareManagedClaudeCreationIntent } from '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeCreation'
import { fixture } from '../../support/convergence/fixture'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { workerOwnershipCompatibilityCases } from '../../support/workerOwnershipCompatibility'
const originalApi = window.opencoveApi,
  originalState = useAppStore.getState()
afterEach(() => {
  vi.unstubAllGlobals()
  window.opencoveApi = originalApi
  useAppStore.setState(originalState, true)
})
it.each(workerOwnershipCompatibilityCases)(
  'opens and saves $generation $profile $client adoption=$adoption independently of ownership support',
  async ({ generation, profile, client, adoption }) => {
    const lookupSupported = !['pre-W8', 'PR1'].includes(generation) && profile !== 'unknown'
    const delivery = generation === 'PR3b' && lookupSupported
    const marker = profile === 'owned' && lookupSupported && ['PR3a', 'PR3b'].includes(generation)
    const state = profile === 'empty' ? null : fixture(marker)
    const capabilities = {
      features: {
        managedClaudeResumeBindingDeliveryV1: delivery,
        managedClaudeResumeBindingV1: false,
      },
    }
    const binding = {
      nodeId: 'agent',
      activationId: 'owned',
      runtimeSessionId: 'runtime',
      tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
      nodeSeen: true,
      bindingRevision: 0,
      observedRevision: 0,
    }
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        const request = JSON.parse(String(options?.body))
        calls.push(request.id)
        if (request.id === 'node.managedClaudeBinding' && !lookupSupported) {
          return new Response(
            JSON.stringify({
              __opencoveControlEnvelope: true,
              ok: false,
              error: { code: 'common.invalid_input' },
            }),
          )
        }
        const value =
          request.id === 'system.capabilities'
            ? capabilities
            : request.id === 'system.operations'
              ? {
                  protocolVersion: 1,
                  operations: lookupSupported ? [{ id: 'node.managedClaudeBinding' }] : [],
                }
              : request.id === 'node.managedClaudeBinding'
                ? {
                    retired: false,
                    managedClaudeBinding: profile === 'owned' ? binding : null,
                    executionDirectory: '/repo',
                  }
                : request.id === 'sync.state'
                  ? { state, revision: 0 }
                  : { revision: 1, corrected: false }
        return new Response(JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value }))
      }),
    )
    window.opencoveApi = {
      controlSurface: { invoke: invokeBrowserControlSurface },
    } as typeof window.opencoveApi
    const candidate = state ?? { ...fixture(false), workspaces: [], activeWorkspaceId: null }
    if (client === 'Web') {
      expect(
        await invokeBrowserControlSurface({ kind: 'query', id: 'sync.state', payload: null }),
      ).toEqual({ state, revision: 0 })
      expect(
        await invokeBrowserControlSurface({
          kind: 'command',
          id: 'sync.writeState',
          payload: { state: candidate, baseRevision: 0 },
        }),
      ).toMatchObject({ revision: 1 })
    } else {
      const api = createRemotePersistenceStore(async () => ({
        hostname: 'localhost',
        port: 1,
        token: 'test',
      }))
      expect(await api.readAppStateSnapshot!()).toEqual({ state, revision: 0 })
      expect(await api.writeAppState(candidate, { baseRevision: 0 })).toMatchObject({ ok: true })
    }
    expect(calls).toContain('sync.state')
    expect(calls).toContain('sync.writeState')
    const ownership = await lookupManagedClaudeOwnership('agent')
    expect(ownership.status).toBe(
      !lookupSupported ? 'unsupported' : profile === 'owned' ? 'owned' : 'unowned',
    )
    if (!lookupSupported || (profile === 'owned' && !delivery)) {
      await expect(readManagedClaudeBinding('agent', 'claude-code')).rejects.toMatchObject({
        details: { reason: 'workerUpgradeRequired' },
      })
    } else {
      expect(await readManagedClaudeBinding('agent', 'claude-code')).toEqual(
        profile === 'owned' ? binding : null,
      )
    }
    const intent = await prepareManagedClaudeCreationIntent({
      kind: 'launchNew',
      expected: {
        activationId: null,
        tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
      },
    })
    expect(intent !== undefined && adoption).toBe(delivery && adoption)
    expect(Boolean(state?.workspaces[0].nodes[0].managedClaudeResumeBindingOwnership)).toBe(marker)
    if (adoption && !delivery) {
      expect(useAppStore.getState().persistNotice).toMatchObject({
        tone: 'warning',
        kind: 'compatibility',
      })
    }
  },
)
