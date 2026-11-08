import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { getPromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type {
  AgentProviderId,
  AgentHookInstallState,
  AgentHookCoverage,
  AgentLaunchKind,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../shared/contracts/dto'
import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import { AgentRunStateRegistry } from './AgentRunStateRegistry'
import type { AgentRunObservation } from '../domain/agentRunState'

export function projectAgentRunState(snapshot: AgentRunSnapshot): TerminalSessionStateEvent {
  return {
    sessionId: snapshot.sessionId,
    agentRunState: snapshot,
    state:
      snapshot.state === 'idle' ? 'standby' : snapshot.state === 'waiting' ? 'waiting' : 'working',
    source: snapshot.source === 'exit' ? 'launch' : (snapshot.source ?? 'launch'),
    degraded: snapshot.quality === 'degraded',
    observationUnavailable: snapshot.state === 'unknown',
    observedAtMs: snapshot.lastTransitionAt,
  }
}

/** Provider observation ingress. Remote raw evidence never enters the local arbiter. */
export class AgentRunStateRuntime {
  private readonly sessions = new Map<
    string,
    {
      incarnation: string
      invocationId: string
      sequence: number
      remote: boolean
      mirrored?: boolean
      launchKind?: AgentLaunchKind
      hookCoverage?: AgentHookCoverage
      hookInstallState?: AgentHookInstallState
      piConversation?: { pid: number; revision: number }
      /** Last raw state per source, for the legacy UI label only (never for decisions). */
      rawStates?: Partial<Record<string, TerminalSessionStateEvent['state']>>
    }
  >()
  private readonly pending = new Map<string, TerminalSessionStateEvent[]>()
  private readonly bindings = new Map<
    string,
    { nodeId: string; projectId: string; spaceId?: string; remote: boolean }
  >()
  setBindings(
    bindings: {
      sessionId: string
      nodeId: string
      projectId: string
      spaceId?: string
      remote: boolean
    }[],
  ): void {
    this.bindings.clear()
    for (const binding of bindings) {
      this.bindings.set(binding.sessionId, binding)
    }
    for (const sessionId of this.sessions.keys()) {
      this.applyBinding(sessionId)
    }
  }
  private applyBinding(sessionId: string): void {
    const binding = this.bindings.get(sessionId)
    const session = this.sessions.get(sessionId)
    if (binding?.remote && session) {
      this.markRemote(sessionId)
    }
    this.registry.bind(sessionId, binding ?? { nodeId: null })
    if (session) {
      this.registry.setRuntimeContext(sessionId, session)
    }
  }
  private markRemote(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    session.remote = true
    const current = this.registry.get({ sessionId })
    if (current && current.state !== 'unknown' && !session.mirrored) {
      session.incarnation += ':remote'
      this.registry.register({
        sessionId,
        provider: current.provider,
        incarnation: session.incarnation,
      })
      this.registry.bind(sessionId, this.bindings.get(sessionId) ?? { nodeId: null })
    }
  }
  constructor(
    readonly registry: AgentRunStateRegistry,
    private readonly now: () => number,
  ) {}

  project(snapshot: AgentRunSnapshot): TerminalSessionStateEvent {
    const session = this.sessions.get(snapshot.sessionId)
    // `unknown` stays explicit in agentRunState (I3). The legacy UI label keeps showing what
    // the selected source last reported, as before the Worker owned the decision.
    // Only a provider report counts; the launch fallback is not evidence of what the agent does.
    const legacyState =
      snapshot.state === 'unknown' &&
      snapshot.source &&
      snapshot.source !== 'launch' &&
      snapshot.source !== 'exit'
        ? session?.rawStates?.[snapshot.source]
        : undefined
    return {
      ...projectAgentRunState(snapshot),
      ...(legacyState ? { state: legacyState, observationUnavailable: false } : {}),
      hookInstallState: session?.hookInstallState,
    }
  }

  metadata(event: TerminalSessionMetadataEvent): void {
    const provider = event.agentProvider ?? event.terminalAgentActivity?.provider
    if (!provider) {
      return
    }
    const existing = this.sessions.get(event.sessionId)
    if (existing?.mirrored) {
      this.applyBinding(event.sessionId)
      return
    }
    const incarnation =
      event.terminalAgentActivity?.invocationId ?? existing?.invocationId ?? event.sessionId
    if (
      !existing ||
      existing.invocationId !== incarnation ||
      this.registry.get({ sessionId: event.sessionId })?.provider !== provider
    ) {
      this.sessions.set(event.sessionId, {
        incarnation,
        invocationId: incarnation,
        sequence: 0,
        remote: event.remote === true || (existing?.remote ?? false),
      })
      this.registry.register({ sessionId: event.sessionId, provider, incarnation })
    }
    const session = this.sessions.get(event.sessionId)!
    // Only launch metadata grants managed provenance. A shim invocation is never upgraded
    // by subsequent identity/launch refreshes, even if it has full lifecycle observations.
    session.launchKind =
      event.terminalAgentActivity || session.launchKind === 'terminal'
        ? 'terminal'
        : (event.agentLaunchKind ?? session.launchKind)
    if (event.hookCoverage !== undefined) {
      session.hookCoverage = event.hookCoverage
    }
    if (event.hookInstallState !== undefined) {
      session.hookInstallState = event.hookInstallState
    }
    if (event.remote) {
      this.markRemote(event.sessionId)
    }
    this.applyBinding(event.sessionId)
    const pending = this.pending.get(event.sessionId)
    this.pending.delete(event.sessionId)
    pending?.forEach(observation => this.observe(observation))
    if (event.terminalAgentActivity?.phase === 'exited') {
      this.exit(event.sessionId)
    }
  }

  private mirror(event: TerminalSessionStateEvent): void {
    const update = event.remoteAgentRun!
    const snapshot =
      update.type === 'snapshot'
        ? update.snapshot
        : update.type === 'event'
          ? update.event.snapshot
          : null
    if (snapshot && !this.sessions.get(event.sessionId)?.mirrored) {
      const incarnation = `remote:${event.sessionId}`
      this.sessions.set(event.sessionId, {
        incarnation,
        invocationId: incarnation,
        sequence: 0,
        remote: true,
        mirrored: true,
      })
      this.registry.register({
        sessionId: event.sessionId,
        incarnation,
        provider: snapshot.provider,
      })
      this.applyBinding(event.sessionId)
    }
    const current = this.registry.get({ sessionId: event.sessionId })
    if (!current) {
      return
    }
    if (!snapshot) {
      if (current.state === 'exited' || current.state === 'unknown') {
        return
      }
      this.registry.mirror(event.sessionId, {
        ...current,
        state: 'unknown',
        quality: 'degraded',
        turn: null,
        turnOutcome: null,
        blockedReason: null,
        source: null,
        lastTransitionAt: this.now(),
      })
      return
    }
    this.registry.mirror(
      event.sessionId,
      snapshot,
      update.type === 'event' && update.event.type === 'agent.turn_completed'
        ? update.event.endedTurn
        : undefined,
    )
  }

  observeClaudeTranscript(record: ClaudeTranscriptObservation): void {
    const session = this.sessions.get(record.sessionId)
    if (!session || session.remote) {
      return
    }
    if (!record.incarnation) {
      return
    }
    this.registry.observeClaudeTranscript(record.sessionId, record.incarnation, record)
  }

  observe(event: TerminalSessionStateEvent): void {
    if (event.remote && event.remoteAgentRun) {
      this.mirror(event)
      return
    }
    if (event.agentRunState) {
      return
    }
    if (!this.sessions.has(event.sessionId)) {
      const provider: AgentProviderId | undefined =
        event.agentProvider ??
        (event.source === 'claude_hook'
          ? 'claude-code'
          : event.source === 'codex_hook'
            ? 'codex'
            : event.source === 'pi_hook'
              ? 'pi'
              : undefined)
      if (!provider) {
        const pending = this.pending.get(event.sessionId) ?? []
        pending.push(event)
        this.pending.set(event.sessionId, pending.slice(-128))
        return
      }
      this.metadata({ sessionId: event.sessionId, resumeSessionId: null, agentProvider: provider })
    }
    const session = this.sessions.get(event.sessionId)!
    if (event.remote) {
      this.markRemote(event.sessionId)
    }
    if (session.remote) {
      return
    }
    // Lifecycle hooks own turn state. Codex's separately spawned legacy notify can arrive
    // after the next submit; it must not replace hook evidence or the legacy UI label.
    if (
      event.source === 'codex_hook' &&
      event.hookEventName === 'notify' &&
      session.hookCoverage === 'lifecycle'
    ) {
      return
    }
    const conversation = event.piConversation
    if (event.source === 'pi_hook' && conversation) {
      if (
        session.piConversation?.pid === conversation.pid &&
        session.piConversation.revision > conversation.revision
      ) {
        return
      }
      if (
        session.piConversation?.pid !== conversation.pid ||
        session.piConversation.revision !== conversation.revision
      ) {
        session.piConversation = conversation
        session.incarnation = `${session.invocationId}:pi:${conversation.pid}:${conversation.revision}`
        this.registry.register({
          sessionId: event.sessionId,
          provider: 'pi',
          incarnation: session.incarnation,
        })
        this.applyBinding(event.sessionId)
      }
    } else if (
      event.source === 'session_file' &&
      session.piConversation &&
      (conversation?.pid !== session.piConversation.pid ||
        conversation?.revision !== session.piConversation.revision)
    ) {
      return
    }
    if (event.hookInstallState !== undefined) {
      session.hookInstallState = event.hookInstallState
    }
    this.registry.setRuntimeContext(event.sessionId, session)
    const name = event.hookEventName
    let boundary: AgentRunObservation['boundary']
    if (
      name === 'UserPromptSubmit' ||
      name === 'agent_start' ||
      name === 'task_started' ||
      name === 'busy'
    ) {
      boundary = {
        kind: 'start',
        inferred: event.source === 'session_file',
        evidence: name === 'UserPromptSubmit' ? 'prompt_submit' : name,
      }
    } else if (
      name === 'Stop' ||
      name === 'StopFailure' ||
      name === 'agent_settled' ||
      name === 'task_complete' ||
      name === 'turn_aborted' ||
      (event.source === 'codex_hook' && name === 'notify')
    ) {
      boundary = {
        kind: 'end',
        outcome:
          name === 'StopFailure' ? 'failed' : name === 'turn_aborted' ? 'aborted' : 'completed',
      }
    }
    if (
      name === 'SessionStart' ||
      name === 'SessionEnd' ||
      (!name && (event.source === 'codex_hook' || event.source === 'claude_hook'))
    ) {
      // Session lifecycle and shell-only synthetic idle are not turn-end evidence.
      boundary = { kind: 'reset' }
    }
    if (!event.observationUnavailable) {
      session.rawStates = { ...session.rawStates, [event.source ?? 'session_file']: event.state }
    }
    this.registry.observe(
      event.sessionId,
      {
        incarnation: session.incarnation,
        sourceSequence: ++session.sequence,
        source: event.source ?? 'session_file',
        observedAt: event.observedAtMs ?? this.now(),
        state: event.observationUnavailable
          ? 'unknown'
          : event.state === 'standby'
            ? 'idle'
            : event.state,
        degraded:
          event.degraded ||
          (session.hookInstallState !== undefined &&
            ['partial', 'error', 'not_installed', 'skipped'].includes(session.hookInstallState)),
        blockedReason: event.blockedReason,
        boundary,
        hookEventName: name,
        emittedAtMs: event.emittedAtMs,
      },
      getPromptSubmissionEvidence(event),
    )
  }

  exit(sessionId: string): void {
    this.pending.delete(sessionId)
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    if (session.remote) {
      const current = this.registry.get({ sessionId })
      if (current && current.state !== 'exited') {
        this.registry.mirror(sessionId, {
          ...current,
          state: 'exited',
          source: 'exit',
          quality: 'authoritative',
          turn: null,
          blockedReason: null,
          lastTransitionAt: this.now(),
        })
      }
      return
    }
    this.registry.observe(sessionId, {
      incarnation: session.incarnation,
      sourceSequence: ++session.sequence,
      source: 'exit',
      state: 'exited',
      observedAt: this.now(),
    })
  }
  forget(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.exit(sessionId)
      this.registry.retire({ sessionId, incarnation: session.incarnation })
    }
    this.sessions.delete(sessionId)
    this.pending.delete(sessionId)
  }
  dispose(): void {
    this.sessions.clear()
    this.bindings.clear()
    this.pending.clear()
    this.registry.dispose()
  }
}
