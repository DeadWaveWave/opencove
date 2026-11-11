import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { holdPrepare, releasePrepare } from '../../e2e/managedClaudePreparationHold'

beforeEach(() => vi.stubGlobal('fetch', globalThis.fetch))
const originalApi = Object.getOwnPropertyDescriptor(window, 'opencoveApi')
afterEach(() => {
  if (originalApi) {
    Object.defineProperty(window, 'opencoveApi', originalApi)
  } else {
    Reflect.deleteProperty(window, 'opencoveApi')
  }
  Reflect.deleteProperty(window, '__heldManagedPrepare')
  Reflect.deleteProperty(window, '__releaseManagedPrepare')
  Reflect.deleteProperty(window, '__dropManagedSync')
  Reflect.deleteProperty(window, '__correctedManagedWrite')
  Reflect.deleteProperty(window, '__managedContinuity')
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

it.each(['corrected', 'merged'] as const)(
  'freezes a read raced by B, then allows canonical B after a %s stale-save receipt',
  async kind => {
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
      },
    )
    const page = {
      addInitScript: async (script: (arg: string) => void, arg: string) => script(arg),
    } as unknown as Page
    await holdPrepare(page, 'agent')
    let canonical = { state: { tuple: 'A' }, revision: 1 }
    let release!: () => void
    let started!: () => void
    const reading = new Promise<void>(resolve => {
      started = resolve
    })
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    let pause = false
    const read = vi.fn(async () => {
      if (pause) {
        started()
        await barrier
      }
      return structuredClone(canonical)
    })
    const write = vi.fn(async () => ({
      ok: true,
      level: 'full',
      bytes: 1,
      revision: 2,
      [kind]: true,
    }))
    window.opencoveApi = {
      meta: { isTest: false, runtime: 'browser' },
      persistence: { readAppState: read, writeAppState: write },
      controlSurface: { invoke: vi.fn() },
    } as unknown as typeof window.opencoveApi
    expect(await window.opencoveApi.persistence.readAppState()).toEqual(canonical)
    pause = true
    const pendingRead = window.opencoveApi.persistence.readAppState()
    try {
      await reading
      canonical = { state: { tuple: 'B' }, revision: 2 }
      Object.assign(window, { __dropManagedSync: true })
      release()
      expect(await pendingRead).toEqual({ state: { tuple: 'A' }, revision: 1 })
      pause = false
      expect(
        await window.opencoveApi.persistence.writeAppState({ state: { tuple: 'A', x: 1200 } }),
      ).toMatchObject({ ok: true, [kind]: true })
      expect(await window.opencoveApi.persistence.readAppState()).toEqual(canonical)
      expect(write).toHaveBeenCalledOnce()
      expect((window as unknown as { __dropManagedSync: boolean }).__dropManagedSync).toBe(true)
    } finally {
      release()
      await pendingRead
    }
  },
)
