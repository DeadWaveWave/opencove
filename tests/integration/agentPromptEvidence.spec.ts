// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { serveAgentRuntimeEvents } from '../../src/app/main/controlSurface/http/agentRuntimeSse'
import { afterEach, expect, it, vi } from 'vitest'
import { inMemoryClaudeHookChannel } from '../support/inMemoryClaudeHookChannel'
import { promptDeliveryRuntimeFixture } from '../support/promptDeliveryRuntimeFixture'
import {
  claudePromptDigest,
  getPromptSubmissionEvidence,
} from '../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { RunStateReceipt } from '../../src/contexts/agent/application/ports/PromptDeliveryPorts'

afterEach(() => vi.restoreAllMocks())
it('keeps prompt evidence on accepted internal receipts and out of public projections, events, replay and logs', async () => {
  const f = promptDeliveryRuntimeFixture()
  const { channel, post } = inMemoryClaudeHookChannel()
  const reservation = await channel.reserveSpawn()
  reservation.commit('s')
  const raw = '  PRIVATE_SENTINEL 中\r\nwith interior\tspaces \t'
  const digest = claudePromptDigest(raw)
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map(method =>
    vi.spyOn(console, method as 'log').mockImplementation(() => {}),
  )
  const ingress: unknown[] = [],
    events: unknown[] = [],
    receipts: RunStateReceipt[] = []
  const baseline = f.registry.list()
  const req = new EventEmitter()
  let frames = ''
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead() {},
    write(chunk: string) {
      frames += chunk
      return true
    },
  })
  serveAgentRuntimeEvents({
    req: req as IncomingMessage,
    res: res as unknown as ServerResponse,
    url: new URL(`http://worker/events?epoch=${baseline.epoch}&afterSeq=${baseline.seq}`),
    registry: f.registry,
    clients: new Set(),
    listenerClients: new Set(),
  })
  const unsubscribe = f.registry.subscribe(
    { epoch: baseline.epoch, afterSeq: baseline.seq },
    {},
    event => events.push(event),
  )
  const fence = f.registry.readFence({ nodeId: 'n' })!
  const unwatch = f.registry.watchFence(fence, receipt => receipts.push(receipt))
  const stop = channel.onState(event => {
    expect(getPromptSubmissionEvidence(event)).toEqual({
      promptId: 'private-provider-id',
      promptDigest: digest,
      providerSessionId: 'provider',
      finalMessage: undefined,
    })
    ingress.push(event)
    f.hub.registerSessionAgentState(event)
  })
  try {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'provider',
      cwd: '/tmp',
      transcript_path: '/tmp/t',
      prompt: raw,
      prompt_id: 'private-provider-id',
    }
    // Failed authentication cannot produce a receipt, regardless of matching text.
    expect(await post('forged', 'UserPromptSubmit', String(Date.now()), payload)).toBe(401)
    expect(receipts).toHaveLength(0)
    expect(
      await post(
        reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
        'UserPromptSubmit',
        String(Date.now()),
        payload,
      ),
    ).toBe(204)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      promptId: 'private-provider-id',
      promptDigest: digest,
      turnId: 'turn',
    })
    const replay: unknown[] = []
    f.registry.subscribe({ epoch: baseline.epoch, afterSeq: baseline.seq }, {}, event =>
      replay.push(event),
    )()
    const publicData = [
      frames,
      ingress,
      events,
      replay,
      f.registry.get({ nodeId: 'n' }),
      f.registry.list(),
      f.registry.readFence({ nodeId: 'n' }),
      f.runtime.project(f.registry.get({ nodeId: 'n' })!),
    ]
    expect(frames).toContain('event: agent.state_changed')
    expect(events.length).toBeGreaterThan(0)
    for (const value of [...publicData, logs.flatMap(log => log.mock.calls)]) {
      const encoded = JSON.stringify(value)
      for (const forbidden of [
        'PRIVATE_SENTINEL',
        'private-provider-id',
        digest!,
        'promptDigest',
      ]) {
        expect(encoded).not.toContain(forbidden)
      }
    }
    // The reducer's public model and source observations never retain comparison metadata.
    const receiptCount = receipts.length
    f.registry.observe(
      's',
      {
        incarnation: 's',
        source: 'claude_hook',
        sourceSequence: 1,
        observedAt: Date.now(),
        hookEventName: 'UserPromptSubmit',
        state: 'working',
        boundary: { kind: 'start', evidence: 'prompt_submit' },
      },
      { promptId: 'rejected', promptDigest: digest },
    )
    expect(receipts).toHaveLength(receiptCount)
  } finally {
    req.emit('close')
    stop()
    unwatch()
    unsubscribe()
    f.dispose()
    await channel.dispose()
  }
})
