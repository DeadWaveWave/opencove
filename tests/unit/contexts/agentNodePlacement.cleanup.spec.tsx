import { act, renderHook } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { useWorkspaceCanvasNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.createNodes'
import * as placement from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.resolvePlacement'
import { registerOperationIntrospectionHandlers } from '../../../src/app/main/controlSurface/handlers/operationIntrospectionHandlers'
import { createAppError } from '../../../src/shared/errors/appError'
import type { CreateNodeInput } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { ManagedClaudeLifecycleReceipt } from '../../../src/shared/contracts/managedClaudeLaunch'
import {
  CanvasStoreTestProvider,
  CANVAS_STORE_TEST_WORKSPACE_ID,
} from '../../support/canvasStoreTestHarness'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { seedWorkspaceCanvasStore } from '../../support/workspaceCanvasStoreHarness'
import { compatibilityFixture, context } from './managedClaudeLaunchCompatibility.helpers'
import { readDefaultAgentSettings } from '../../support/agentSettingsReader'

const receipt: ManagedClaudeLifecycleReceipt = {
  commitRevision: null,
  binding: {
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'replacement',
    tuple: { resumeSessionId: 'new', resumeSessionIdVerified: true },
    nodeSeen: false,
    bindingRevision: 0,
    observedRevision: 0,
  },
}
function fixture(cleanupSupport = false) {
  const worker = compatibilityFixture({ enabled: false, persisted: false })
  registerOperationIntrospectionHandlers(worker.surface)
  const cleanup = vi.fn(async () => ({ cleaned: false }))
  if (cleanupSupport) {
    worker.surface.register('session.cleanupUnreferenced', {
      kind: 'command',
      validate: payload => payload,
      defaultErrorCode: 'persistence.unavailable',
      handle: cleanup,
    })
  }
  const kill = vi.fn(async () => {})
  const invoke = vi.fn(async request => {
    const result = await worker.surface.invoke(context, request)
    if (!result.ok) {
      throw createAppError(result.error)
    }
    return result.value
  })
  window.opencoveApi = {
    pty: { kill },
    controlSurface: { invoke },
  } as unknown as typeof window.opencoveApi
  // Force exhausted geometry only; exercise the real creation hook, wrapper and registry.
  const geometry = vi.spyOn(placement, 'resolveNodesPlacement').mockReturnValue({
    placement: { x: 0, y: 0 },
    canPlace: false,
  })
  const message = vi.fn()
  seedWorkspaceCanvasStore({ workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID })
  const hook = renderHook(
    () =>
      useWorkspaceCanvasNodeCreation({
        workspaceId: 'workspace',
        onShowMessage: message,
        readAgentSettings: readDefaultAgentSettings,
      }),
    { wrapper: CanvasStoreTestProvider },
  )
  const place = (managedClaudeLifecycle?: ManagedClaudeLifecycleReceipt) =>
    hook.result.current.createNodeForSession({
      nodeId: 'agent',
      sessionId: 'replacement',
      title: 'Agent',
      kind: 'agent',
      anchor: { x: 0, y: 0 },
      agent: { provider: 'claude-code' } as CreateNodeInput['agent'],
      ...(managedClaudeLifecycle ? { managedClaudeLifecycle } : {}),
    } as CreateNodeInput)
  return {
    ...worker,
    place,
    invoke,
    cleanup,
    kill,
    // The nodes the document holds: the creation hook writes the store through the writer of its
    // context, so a failed placement that wrote a node anyway shows here.
    storedNodes: () => readWorkspaceDocument(CANVAS_STORE_TEST_WORKSPACE_ID)?.nodes,
    message,
    dispose: () => {
      geometry.mockRestore()
      hook.unmount()
      worker.runtime.dispose()
    },
  }
}

it('cleans a flag-off Claude launch when real placement fails against an older Worker registry', async () => {
  const f = fixture()
  try {
    expect(f.surface.hasOperation('session.cleanupUnreferenced')).toBe(false)
    expect(await f.launch()).toMatchObject({ ok: true, value: { sessionId: 'replacement' } })
    expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
    await act(async () => {
      expect(await f.place()).toBeNull()
    })
    expect(f.kill).toHaveBeenCalledExactlyOnceWith({ sessionId: 'replacement' })
    expect(f.invoke).not.toHaveBeenCalled()
    expect(f.storedNodes()).toEqual([])
    expect(f.message).toHaveBeenCalledWith(expect.any(String), 'warning')
  } finally {
    f.dispose()
  }
})

it('leaves managed placement cleanup with the Worker after negotiating support', async () => {
  const f = fixture(true)
  try {
    await act(async () => {
      expect(await f.place(receipt)).toBeNull()
    })
    expect(f.invoke.mock.calls.map(([request]) => request.id)).toEqual([
      'system.operations',
      'session.cleanupUnreferenced',
    ])
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    expect(f.kill).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

it('never speculatively kills a managed receipt when the Worker lacks cleanup support', async () => {
  const f = fixture()
  try {
    await expect(f.place(receipt)).rejects.toMatchObject({
      code: 'agent.managed_launch_rejected',
      details: { reason: 'capabilityUnavailable' },
    })
    expect(f.invoke.mock.calls.map(([request]) => request.id)).toEqual(['system.operations'])
    expect(f.kill).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})
