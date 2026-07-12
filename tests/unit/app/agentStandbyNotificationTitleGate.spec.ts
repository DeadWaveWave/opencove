import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStandbyNotificationPayload } from '../../../src/app/renderer/shell/hooks/useAgentStandbyNotificationWatcher'
import {
  AGENT_STANDBY_TITLE_WAIT_TIMEOUT_MS,
  waitForAgentStandbyNotificationTitle,
} from '../../../src/app/renderer/shell/utils/agentStandbyNotificationTitleGate'

function createPayload(
  overrides: Partial<AgentStandbyNotificationPayload> = {},
): AgentStandbyNotificationPayload {
  return {
    sessionId: 'runtime-session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'OpenCove',
    workspacePath: '/tmp/opencove',
    nodeId: 'agent-1',
    title: 'codex · gpt-5.2-codex',
    awaitingSessionTitle: true,
    executionDirectory: '/tmp/opencove',
    taskId: null,
    ...overrides,
  }
}

function createPayloadSource(initial: AgentStandbyNotificationPayload | null) {
  let current = initial
  const listeners = new Set<() => void>()

  return {
    resolveLatest: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(next: AgentStandbyNotificationPayload | null) {
      current = next
      listeners.forEach(listener => listener())
    },
  }
}

describe('waitForAgentStandbyNotificationTitle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits as soon as the session title replaces the launch title', async () => {
    vi.useFakeTimers()
    const initial = createPayload()
    const source = createPayloadSource(initial)
    const pending = waitForAgentStandbyNotificationTitle({
      initial,
      resolveLatest: source.resolveLatest,
      subscribe: source.subscribe,
    })

    source.update(
      createPayload({
        title: 'codex · Rename direct Agent windows',
        awaitingSessionTitle: false,
      }),
    )

    await expect(pending).resolves.toMatchObject({
      title: 'codex · Rename direct Agent windows',
    })
  })

  it('falls back to the latest title after at most one second', async () => {
    vi.useFakeTimers()
    const initial = createPayload()
    const source = createPayloadSource(initial)
    const pending = waitForAgentStandbyNotificationTitle({
      initial,
      resolveLatest: source.resolveLatest,
      subscribe: source.subscribe,
    })

    await vi.advanceTimersByTimeAsync(AGENT_STANDBY_TITLE_WAIT_TIMEOUT_MS - 1)
    let didSettle = false
    void pending.then(() => {
      didSettle = true
    })
    await Promise.resolve()
    expect(didSettle).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual(initial)
  })

  it('does not emit after the pending notification is cancelled', async () => {
    vi.useFakeTimers()
    const initial = createPayload()
    const source = createPayloadSource(initial)
    const abortController = new AbortController()
    const pending = waitForAgentStandbyNotificationTitle({
      initial,
      resolveLatest: source.resolveLatest,
      subscribe: source.subscribe,
      signal: abortController.signal,
    })

    abortController.abort()
    source.update(
      createPayload({
        title: 'codex · A stale title',
        awaitingSessionTitle: false,
      }),
    )
    await vi.advanceTimersByTimeAsync(AGENT_STANDBY_TITLE_WAIT_TIMEOUT_MS)

    await expect(pending).resolves.toBeNull()
  })
})
