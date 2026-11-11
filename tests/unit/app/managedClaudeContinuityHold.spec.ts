import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { holdPrepare, releasePrepare } from '../../e2e/managedClaudePreparationHold'

const originalApi = Object.getOwnPropertyDescriptor(window, 'opencoveApi')
afterEach(() => {
  if (originalApi) {
    Object.defineProperty(window, 'opencoveApi', originalApi)
  } else {
    Reflect.deleteProperty(window, 'opencoveApi')
  }
  Reflect.deleteProperty(window, '__heldManagedPrepare')
  Reflect.deleteProperty(window, '__releaseManagedPrepare')
  vi.unstubAllGlobals()
})

it('passes a terminal-first response and holds only the target agent with binding A', async () => {
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
    },
  )
  const page = {
    addInitScript: async (script: (arg: string) => void, arg: string) => script(arg),
    evaluate: async (script: () => void) => script(),
  } as unknown as Page
  await holdPrepare(page, 'agent')
  const agent = {
    nodeId: 'agent',
    managedClaudeBinding: {
      tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
      activationId: 'activation',
    },
  }
  const terminal = { nodeId: 'terminal', kind: 'terminal' }
  window.opencoveApi = {
    persistence: { readAppState: vi.fn(), writeAppState: vi.fn() },
    controlSurface: {
      invoke: vi.fn(async request => ({
        nodes: [request.payload.nodeIds[0] === 'terminal' ? terminal : agent],
      })),
    },
  } as unknown as typeof window.opencoveApi
  const returned = vi.fn()
  const invoke = (nodeId: string) =>
    window.opencoveApi.controlSurface.invoke({
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace', nodeIds: [nodeId] },
    })
  const terminalResponse = invoke('terminal').then(returned)
  let agentResponse: Promise<unknown> | undefined
  try {
    await vi.waitFor(() =>
      expect(
        returned.mock.calls.length > 0 ||
          Boolean((window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare),
      ).toBe(true),
    )
    expect(returned).toHaveBeenCalledExactlyOnceWith({ nodes: [terminal] })
    expect(
      (window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare,
    ).toBeUndefined()
    agentResponse = invoke('agent').then(returned)
    await vi.waitFor(() =>
      expect(
        (window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare,
      ).toBeTruthy(),
    )
    const held = (window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare
    expect(held).toEqual(agent)
    expect(returned).toHaveBeenCalledOnce()
    agent.managedClaudeBinding.tuple.resumeSessionId = 'B'
    expect(held).toMatchObject({ managedClaudeBinding: { tuple: { resumeSessionId: 'A' } } })
    await releasePrepare(page)
    await agentResponse
    expect(returned).toHaveBeenCalledTimes(2)
  } finally {
    await releasePrepare(page)
    await Promise.all([terminalResponse, agentResponse])
  }
})
