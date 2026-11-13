import { vi } from 'vitest'
import { clearIngressFixture, clearTranscript } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import type { AgentRunEntry } from '../../../src/contexts/agent/application/AgentRunStateEntry'

export const phases = [
  'receipt',
  'file working',
  'file waiting',
  'user input',
  'pending End',
  'fresh resume',
  'completed turn',
  'repeated clears',
] as const
export type Phase = (typeof phases)[number]
type Action = { name: string; run(): void | Promise<void> }
export async function clearInterleavingFixture(phase: Phase) {
  const archive = new InMemoryAgentTurnArchive({ now: () => Date.now() })
  const append = vi.spyOn(archive, 'append')
  const f = await clearIngressFixture(false, false, archive)
  const capture = (id: string) => {
    const input = {
      sessionId: 's',
      provider: 'claude-code' as const,
      resumeSessionId: id,
      cwd: '/workspace',
      startedAtMs: Date.now(),
      launchMode: 'resume' as const,
    }
    const publish = createSessionStatePublisher({
      getInput: () => input,
      onState: event => f.runtime.observe(event),
    })
    return captureSessionStateObservation(
      input,
      1,
      record => f.runtime.observeClaudeTranscript(record),
      publish,
    )
  }
  const oldFile = capture('A')
  const transcript = (
    id: string,
    conversationGeneration: number | undefined,
    position: number,
    line: string,
  ) =>
    f.runtime.observeClaudeTranscript({
      sessionId: 's',
      incarnation: 's',
      providerSessionId: id,
      conversationGeneration,
      generation: 1,
      fileIdentity: `${id}.jsonl`,
      position,
      baseline: true,
      origin: 'hook',
      record: parseClaudeTranscript(line),
    })
  const oldTranscript = (position: number, line: string) =>
    transcript('A', oldFile.generation, position, line)
  if (phase === 'repeated clears') {
    await f.send('C', 'SessionStart', 8, undefined, 'clear')
    await f.settle()
  }
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  await f.settle()
  if (phase === 'pending End' || phase === 'fresh resume') {
    await f.send('B', 'SessionEnd', 30, undefined, undefined, { reason: 'clear' })
    if (phase === 'fresh resume') {
      await f.settle()
      await f.send('B', 'SessionStart', 40, undefined, 'resume')
    }
  }
  if (phase === 'completed turn') {
    await f.send('B', 'UserPromptSubmit', 20, 'b')
    await f.send('B', 'Stop', 25, 'b')
  }
  const currentFile = capture('B')
  const currentTranscript = (position: number, line: string) =>
    transcript('B', currentFile.generation, position, line)
  if (phase === 'file working' || phase === 'file waiting') {
    currentFile.state('s', phase === 'file working' ? 'working' : 'waiting')
  }
  if (phase === 'user input') {
    currentTranscript(7, clearTranscript[6])
  }
  // Project once through the real publisher/runtime to preserve source ordinals while shuffling
  // registry arrivals. Reassigning ordinals on arrival would permute different evidence instead.
  const projected: Parameters<typeof f.registry.observe>[] = []
  const project = vi.spyOn(f.registry, 'observe').mockImplementation((...args) => {
    projected.push(args)
  })
  for (const state of ['working', 'waiting', 'standby'] as const) {
    currentFile.state('s', state)
  }
  project.mockRestore()
  const live: Action[] = projected.length
    ? projected.map(args => ({
        name: `B ${args[1].state}`,
        run: () => f.registry.observe(...args),
      }))
    : (['working', 'waiting', 'standby'] as const).map(state => ({
        name: `B ${state}`,
        run: () => currentFile.state('s', state),
      }))
  live.push(
    { name: 'B metadata', run: () => currentTranscript(3, clearTranscript[2]) },
    { name: 'B user', run: () => currentTranscript(7, clearTranscript[6]) },
  )
  const stale: Action[] = (['working', 'waiting', 'standby'] as const).map(state => ({
    name: `A ${state}`,
    run: () => oldFile.state('s', state),
  }))
  for (const [name, at] of [
    ['UserPromptSubmit', 4],
    ['Stop', 5],
    ['SessionEnd', 6],
  ] as const) {
    stale.push({ name: `A ${name}`, run: () => f.send('A', name, at, 'late-A') })
  }
  for (const [name, index] of [
    ['metadata', 2],
    ['user', 6],
  ] as const) {
    stale.push({
      name: `A ${name}`,
      run: () => oldTranscript(index + 1, clearTranscript[index].replaceAll('"B"', '"A"')),
    })
  }
  function view() {
    // Include owner/cursor/source state as well as the public outputs: an inert callback must
    // not silently advance a watermark, consume a receipt or alter future reconciliation.
    const entry = (f.registry as unknown as { entries: Map<string, AgentRunEntry> }).entries.get(
      's',
    )!
    return JSON.stringify(
      {
        fence: f.fence(),
        list: f.registry.list(),
        identity: f.registry.promptIdentity(f.fence()),
        entry,
        session: (f.runtime as unknown as { sessions: Map<string, unknown> }).sessions.get('s'),
      },
      (_key, value) =>
        value instanceof Set || value instanceof Map
          ? [...value]
          : typeof value === 'function'
            ? undefined
            : value,
    )
  }
  const exact = (turnId: string) => {
    try {
      return f.registry.finalMessage({ nodeId: 'n', turnId })
    } catch (error) {
      return {
        code: (error as { code: string }).code,
        details: (error as { details: unknown }).details,
      }
    }
  }
  const output = () =>
    JSON.stringify(
      {
        fence: f.fence(),
        list: f.registry.list(),
        identity: f.registry.promptIdentity(f.fence()),
        exact: append.mock.calls.map(([record]) => exact(record.turnId)),
        archive: append.mock.calls.map(([record]) =>
          archive.getExact({ nodeId: 'n', turnId: record.turnId }),
        ),
      },
      (key, value) => (['cursor', 'seq'].includes(key) ? undefined : value),
    )
  return {
    ...f,
    live,
    stale,
    view,
    output,
    captured: { A: oldFile.generation, B: currentFile.generation },
  }
}
