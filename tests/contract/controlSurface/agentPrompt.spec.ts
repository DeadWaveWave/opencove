import { agentPromptResultSchema } from '../../../src/shared/contracts/dto/agentPrompt'
import { sessionGrantAllowsOperation } from '../../../src/app/main/controlSurface/http/sessionGrantAuthorization'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import {
  agentDeliveryGetOperation,
  agentPromptOperation as op,
} from '../../../src/shared/contracts/controlSurface/operations/domains/agent'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentPromptHandlers } from '../../../src/app/main/controlSurface/handlers/agentPromptHandlers'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createAppError, isAppErrorDescriptor } from '../../../src/shared/errors/appError'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

const ctx = { now: () => new Date(), capabilities: {} } as ControlSurfaceContext
describe('agent.prompt contract', () => {
  it('exports a strict described interact command schema and normalizes only at the boundary', () => {
    expect(sessionGrantAllowsOperation(op.id, 'interact')).toBe(true)
    expect(sessionGrantAllowsOperation(op.id, 'read')).toBe(false)
    expect(op.scope).toBe('interact')
    expect(op.kind).toBe('command')
    const schema = z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })
    expect(schema.additionalProperties).toBe(false)
    for (const field of ['text', 'nodeId', 'sessionId', 'timeoutMs']) {
      expect(schema.properties?.[field]).toHaveProperty('description')
    }
    expect(op.normalize({ nodeId: ' n ', text: 'hello' })).toMatchObject({
      nodeId: 'n',
      timeoutMs: 15000,
    })
    for (const input of [
      { text: 'a' },
      { text: 'a', nodeId: 'n', sessionId: 's' },
      { text: 'a', nodeId: 'n', timeoutMs: 60001 },
    ]) {
      expect(() => op.normalize(input)).toThrow()
    }
  })
  it('registers in real composition and preserves refusal code and typed dispatch details', async () => {
    const write = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64000,
      ptyRuntime: {
        write,
        spawnSession: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
      },
    })
    const surface = createControlSurface()
    const providers = new AgentProviderRegistry(createBuiltinAgentProviderContributions())
    registerAgentPromptHandlers(surface, hub, providers)
    hub.agentRuns.registry.register({
      sessionId: 's',
      nodeId: 'n',
      provider: 'claude-code',
      incarnation: 'i',
    })
    hub.agentRuns.registry.setRuntimeContext('s', { remote: false, launchKind: 'managed' })
    hub.agentRuns.registry.observe('s', {
      source: 'claude_hook',
      incarnation: 'i',
      observedAt: Date.now(),
      sourceSequence: 1,
      state: 'waiting',
      blockedReason: 'permission',
      hookEventName: 'PermissionRequest',
    })
    const result = await surface.invoke(ctx, {
      kind: 'command',
      id: 'agent.prompt',
      payload: { nodeId: 'n', text: 'hello' },
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'agent.blocked',
        details: {
          blockedReason: 'permission',
          reason: 'waiting',
          pasteDispatchAttempted: false,
          submitDispatchAttempted: false,
          retryable: true,
        },
      },
    })
    expect(write).not.toHaveBeenCalled()
    for (const code of op.errors) {
      expect(isAppErrorDescriptor(createAppError(code).toDescriptor())).toBe(true)
    }
    hub.agentRuns.dispose()
  })
})

it('declares bounded submission evidence without promising causation, completion or private content', () => {
  const base = {
    deliveryId: 'd',
    nodeId: 'n',
    sessionId: 's',
    phase: 'submission_observed',
    turnId: 't',
  }
  for (const textComparison of ['matched', 'different', 'unavailable']) {
    expect(
      agentPromptResultSchema.safeParse({
        ...base,
        textComparison,
        comparisonProfile: 'claude-code-v1',
        promptId: 'provider-id',
      }).success,
    ).toBe(true)
  }
  expect(
    agentPromptResultSchema.safeParse({ ...base, textComparison: 'unavailable' }).success,
  ).toBe(true)
  for (const extra of [
    { textComparison: 'matched' },
    { textComparison: 'submission_matched' },
    { textComparison: 'different', comparisonProfile: 'codex-v1' },
    { textComparison: 'unavailable', promptId: 'x'.repeat(257) },
    { textComparison: 'unavailable', promptId: 'bad\nid' },
  ]) {
    expect(agentPromptResultSchema.safeParse({ ...base, ...extra }).success).toBe(false)
  }
})

it('negotiates steering and validates caller UUIDs; delivery lookup requires interact scope', () => {
  expect(sessionGrantAllowsOperation(agentDeliveryGetOperation.id, 'interact')).toBe(true)
  expect(sessionGrantAllowsOperation(agentDeliveryGetOperation.id, 'read')).toBe(false)
  const valid = {
    nodeId: 'n',
    text: 'hello',
    whenBusy: 'steer',
    deliveryId: 'd0e2d356-aecf-4784-84ce-9a49c8ed0b78',
  }
  expect(op.input.safeParse(valid).success).toBe(true)
  expect(op.input.safeParse({ ...valid, whenBusy: 'queue' }).success).toBe(false)
  expect(op.input.safeParse({ ...valid, deliveryId: 'not-uuid' }).success).toBe(false)
  expect(z.toJSONSchema(op.input).properties).toHaveProperty('whenBusy')
})

it('exports the negotiated exact-turn guard and rejects empty expectations', () => {
  const base = { nodeId: 'n', text: 'steer', whenBusy: 'steer' }
  expect(op.input.safeParse({ ...base, expectTurnId: 'turn' }).success).toBe(true)
  expect(op.input.safeParse({ ...base, expectTurnId: '  ' }).success).toBe(false)
  expect(z.toJSONSchema(op.input).properties).toHaveProperty('expectTurnId')
})
