import { expect, it } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { projectAgentRuntimeObservation } from '../../../src/contexts/workspace/presentation/renderer/utils/agentRuntimeObservation'
import { resolveAgentPresentation } from '../../../src/contexts/workspace/presentation/renderer/utils/agentPresentation'
import { createWindowSignalDetector } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/signalDetector'
import type { AgentRunEvent } from '../../../src/shared/contracts/dto/agentRunState'

function fixture() {
  let now = 100
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => now++,
    createTurnId: () => 'turn',
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => now++)
  runtime.metadata({ sessionId: 's', resumeSessionId: null, agentProvider: 'claude-code' })
  return { runtime, registry }
}

it.each(['standby', 'running', 'waiting', null] as const)(
  'keeps the legacy %s label when the Worker has no observation',
  status => {
    const { runtime, registry } = fixture()
    const data = { kind: 'agent', sessionId: 's', status } as TerminalNodeData
    const snapshot = registry.get({ sessionId: 's' })!
    const next = projectAgentRuntimeObservation(data, runtime.project(snapshot))?.data ?? data
    expect(resolveAgentPresentation(next).status).toBe(status)
    expect(next.status).toBe(status)
    expect(snapshot.state).toBe('unknown')
    runtime.dispose()
  },
)

it('keeps a previous UI observation when the decided state becomes unknown', () => {
  const { runtime, registry } = fixture()
  const data = {
    kind: 'agent',
    sessionId: 's',
    status: 'running',
    agentRuntimeObservation: {
      status: 'standby',
      source: 'session_file',
      hookInstallState: null,
      degraded: false,
    },
  } as TerminalNodeData
  const next =
    projectAgentRuntimeObservation(data, runtime.project(registry.get({ sessionId: 's' })!))
      ?.data ?? data
  expect(resolveAgentPresentation(next).status).toBe('standby')
  expect(next.status).toBe('running')
  runtime.dispose()
})

it.each(['hook', 'file'] as const)(
  'delivers %s start → completion through Worker and UI projection',
  source => {
    const { runtime, registry } = fixture()
    const events: AgentRunEvent[] = []
    const cursor = registry.list()
    registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event =>
      events.push(event),
    )
    let data = { kind: 'agent', sessionId: 's', status: 'standby' } as TerminalNodeData
    const detector = createWindowSignalDetector()
    const observeUi = () => {
      data =
        projectAgentRuntimeObservation(data, runtime.project(registry.get({ sessionId: 's' })!))
          ?.data ?? data
      const presentation = resolveAgentPresentation(data)
      return detector.observe(
        [{ id: 'node', isAgent: presentation.isAgent, status: presentation.status }],
        1000,
      )
    }
    const stateSource = source === 'hook' ? 'claude_hook' : 'session_file'
    runtime.observe({
      sessionId: 's',
      source: stateSource,
      state: 'standby',
      ...(source === 'hook' ? { hookEventName: 'Stop' } : {}),
    })
    expect(observeUi()).toEqual([])
    expect(events.filter(event => event.type === 'agent.turn_completed')).toEqual([])
    runtime.observe({
      sessionId: 's',
      source: stateSource,
      state: 'working',
      ...(source === 'hook' ? { hookEventName: 'UserPromptSubmit' } : {}),
    })
    expect(registry.get({ sessionId: 's' })?.turn?.start).toBe(
      source === 'hook' ? 'observed' : 'inferred',
    )
    expect(observeUi()).toEqual([])
    runtime.observe({
      sessionId: 's',
      source: stateSource,
      state: 'standby',
      ...(source === 'hook' ? { hookEventName: 'Stop' } : {}),
    })
    expect(registry.get({ sessionId: 's' })?.turnOutcome).toBe('completed')
    expect(events.filter(event => event.type === 'agent.turn_completed')).toHaveLength(1)
    expect(observeUi()).toEqual([{ id: 'node', kind: 'complete' }])
    runtime.dispose()
  },
)

it('does not infer a turn from a working baseline, degraded edge, or idle alone', () => {
  for (const states of [
    [{ state: 'standby' }],
    [{ state: 'working' }, { state: 'standby' }],
    [{ state: 'standby' }, { state: 'working', degraded: true }, { state: 'standby' }],
  ] as const) {
    const { runtime, registry } = fixture()
    const events: AgentRunEvent[] = []
    const cursor = registry.list()
    registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event =>
      events.push(event),
    )
    for (const observation of states) {
      runtime.observe({ sessionId: 's', source: 'session_file', ...observation })
    }
    expect(registry.get({ sessionId: 's' })?.turn).toBeNull()
    expect(events.filter(event => event.type === 'agent.turn_completed')).toEqual([])
    runtime.dispose()
  }
})

it('preserves a terminal agent overlay label for an unknown snapshot', () => {
  const { runtime, registry } = fixture()
  const data = {
    kind: 'terminal',
    sessionId: 's',
    status: null,
    agentOverlay: { provider: 'claude-code', status: 'standby', startedAtMs: 1 },
  } as TerminalNodeData
  const next =
    projectAgentRuntimeObservation(data, runtime.project(registry.get({ sessionId: 's' })!))
      ?.data ?? data
  expect(resolveAgentPresentation(next).status).toBe('standby')
  expect(next.status).toBeNull()
  runtime.dispose()
})

// e2e: workspace-canvas.claude-hook "session-file fallback and visible degradation when hook
// install fails" shows Standby, as before the Worker owned the decision.
it('labels a degraded session-file fallback with the state that source reported', () => {
  const { runtime, registry } = fixture()
  runtime.observe({
    sessionId: 's',
    state: 'standby',
    source: 'session_file',
    hookInstallState: 'error',
    observedAtMs: 500,
  })
  const snapshot = registry.get({ sessionId: 's' })!
  expect(snapshot.state).toBe('unknown')
  expect(snapshot.source).toBe('session_file')
  const projected = runtime.project(snapshot)
  expect(projected.state).toBe('standby')
  expect(projected.agentRunState?.state).toBe('unknown')
  expect(projected.degraded).toBe(true)
  expect(projected.observationUnavailable).toBe(false)
  const running = { kind: 'agent', sessionId: 's', status: 'running' } as TerminalNodeData
  const shown = projectAgentRuntimeObservation(running, projected)?.data
  expect(resolveAgentPresentation(shown ?? running).status).toBe('standby')
  expect(shown?.agentRuntimeObservation).toMatchObject({ source: 'session_file', degraded: true })
  // Without the Worker's explicit attestation an unknown decision never changes the label.
  const { observationUnavailable: _dropped, ...withoutFlag } = projected
  expect(projectAgentRuntimeObservation(running, withoutFlag)).toBeNull()
  runtime.dispose()
})

it('keeps the previous label for an unknown decision with no reporting source', () => {
  const { runtime, registry } = fixture()
  const projected = runtime.project(registry.get({ sessionId: 's' })!)
  expect(projected.observationUnavailable).toBe(true)
  const running = { kind: 'agent', sessionId: 's', status: 'running' } as TerminalNodeData
  expect(projectAgentRuntimeObservation(running, projected)).toBeNull()
  runtime.dispose()
})

it('never labels an agent from the launch fallback alone', () => {
  const { runtime, registry } = fixture()
  runtime.observe({ sessionId: 's', state: 'working', source: 'launch', degraded: true })
  const projected = runtime.project(registry.get({ sessionId: 's' })!)
  expect(projected.observationUnavailable).toBe(true)
  const standby = { kind: 'agent', sessionId: 's', status: 'standby' } as TerminalNodeData
  expect(projectAgentRuntimeObservation(standby, projected)).toBeNull()
  runtime.dispose()
})
