import { describe, it, expect, vi } from 'vitest'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerOperationIntrospectionHandlers } from '../../../src/app/main/controlSurface/handlers/operationIntrospectionHandlers'
import {
  readManagedClaudeBinding,
  killUnownedNodeRuntime,
  readManagedClaudeExecutionContext,
} from '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeLifecycle'
import { createAppError } from '../../../src/shared/errors/appError'
import { compatibilityFixture, context } from './managedClaudeLaunchCompatibility.helpers'
const node = {
  id: 'agent',
  data: { kind: 'agent', sessionId: 'live', agent: { provider: 'claude-code' } },
}
function fixture(legacy = false, compatible = true) {
  const f = compatibilityFixture({ persisted: false })
  f.surface.register('system.capabilities', {
    kind: 'query',
    validate: x => x,
    handle: () => ({ features: { managedClaudeResumeBindingDeliveryV1: compatible } }),
    defaultErrorCode: 'common.unexpected',
  })
  registerOperationIntrospectionHandlers(f.surface)
  if (!legacy) {
    registerNodeControlHandlers(f.surface, {
      getPersistenceStore: f.getPersistenceStore,
      topology: {} as never,
    })
  }
  const kill = vi.fn(async () => {})
  window.opencoveApi = {
    pty: { kill },
    controlSurface: {
      invoke: async request => {
        const result = await f.surface.invoke(context, request)
        if (!result.ok) {
          throw createAppError(result.error)
        }
        return result.value
      },
    },
  } as typeof window.opencoveApi
  return { ...f, kill }
}
describe('managed Claude ownership lookup without persisted nodes', () => {
  it('requires a Worker upgrade when ownership lookup is unsupported', async () => {
    const f = fixture(true)
    try {
      expect(f.surface.hasOperation('node.managedClaudeBinding')).toBe(false)
      await expect(killUnownedNodeRuntime(node)).rejects.toMatchObject({
        details: { reason: 'workerUpgradeRequired' },
      })
      await expect(readManagedClaudeBinding('agent', 'claude-code')).rejects.toMatchObject({
        details: { reason: 'workerUpgradeRequired' },
      })
      await expect(readManagedClaudeExecutionContext('agent', 'claude-code')).rejects.toMatchObject(
        { details: { reason: 'workerUpgradeRequired' } },
      )
      expect(f.kill).not.toHaveBeenCalled()
      expect(f.store.readAppState).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
  it('proves ledger absence and preserves legacy cleanup for an unpersisted node', async () => {
    const f = fixture()
    try {
      await expect(killUnownedNodeRuntime(node)).resolves.toBeUndefined()
      expect(f.kill).toHaveBeenCalledExactlyOnceWith({ sessionId: 'live' })
      await expect(readManagedClaudeExecutionContext('agent', 'claude-code')).resolves.toBeNull()
      expect(f.store.readAppState).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
  it('returns row-only ownership and retains its runtime even when node.get cannot find the node', async () => {
    const f = fixture()
    await f.store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'unseen',
      runtimeSessionId: 'live',
      tuple: { resumeSessionId: 'owned', resumeSessionIdVerified: true },
    })
    try {
      const binding = await readManagedClaudeBinding('agent', 'claude-code')
      expect(binding).toMatchObject({
        activationId: 'unseen',
        runtimeSessionId: 'live',
        nodeSeen: false,
      })
      await killUnownedNodeRuntime(node)
      expect(f.kill).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
  it('does not treat an unavailable ownership read as absence', async () => {
    const f = fixture()
    f.store.observeManagedClaudeNode.mockImplementation(() => {
      throw createAppError('persistence.unavailable')
    })
    try {
      await expect(killUnownedNodeRuntime(node)).rejects.toMatchObject({
        code: 'persistence.unavailable',
      })
      expect(f.kill).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
  it('retains an invalid-input failure when the registry advertises ownership support', async () => {
    const f = fixture()
    f.store.observeManagedClaudeNode.mockImplementation(() => {
      throw createAppError('common.invalid_input')
    })
    try {
      await expect(killUnownedNodeRuntime(node)).rejects.toMatchObject({
        code: 'common.invalid_input',
      })
      expect(f.kill).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
})

it('does not treat an omitted binding field as definitive absence', async () => {
  const kill = vi.fn(async () => {})
  window.opencoveApi = {
    pty: { kill },
    controlSurface: {
      invoke: vi.fn(async () => ({ retired: false, managedClaudeBinding: undefined })),
    },
  } as unknown as typeof window.opencoveApi
  await expect(killUnownedNodeRuntime(node)).rejects.toMatchObject({
    code: 'persistence.unavailable',
  })
  expect(kill).not.toHaveBeenCalled()
})

it('requires upgrading a Worker that has lookup but lacks safe delivery for existing ownership', async () => {
  const f = fixture(false, false)
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'B', resumeSessionIdVerified: true },
  })
  try {
    await expect(killUnownedNodeRuntime(node)).rejects.toMatchObject({
      details: { reason: 'workerUpgradeRequired' },
    })
    expect(f.kill).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
  }
})
