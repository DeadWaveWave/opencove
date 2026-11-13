import {
  getPromptSubmissionEvidence,
  setPromptSubmissionEvidence,
} from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import type { ClaudeBindingEvidence } from '../../../../shared/runtime/agentHook/claudeBindingEvidence'
import { ClaudeTranscriptGeneration } from './ClaudeTranscriptGeneration'
import { SessionTurnStateWatcher } from '../../../../contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import {
  claudeTranscriptAccess,
  claudeTranscriptRoots,
  type ClaudeTranscriptRoots,
} from '../../../../contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import type { ClaudeTranscriptObservation } from '../../../../shared/runtime/agentHook/claudeTranscript'
import { debugAgentContinuation } from '../../../../shared/runtime/agentHook/agentContinuationDiagnostics'
import type {
  PrivateHookObserver,
  PrivateHookContext,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import type { ClaudeHookEnvelope } from './claudeHookProtocol'

let generation = 0
/** A credential owns launch roots, invocation validity, provider lifecycle and all file IO. */
export class ClaudeHookTranscriptObserver implements PrivateHookObserver<ClaudeHookEnvelope> {
  private credential?: object
  private readonly earlySubmits = new Map<string, number>()
  private watcher?: SessionTurnStateWatcher
  private path?: string
  private disposed = false
  private version = 0
  private pending = false
  private retry?: ReturnType<typeof setTimeout>
  private readonly lifecycle = new ClaudeTranscriptGeneration()
  private demand = false
  private hotUntil = 0
  private currentGeneration = 0
  private unavailablePosition = 0
  private readonly roots: ClaudeTranscriptRoots
  constructor(
    private readonly emit: (record: ClaudeTranscriptObservation) => void,
    private readonly configDirectories: readonly string[],
    private readonly bindingEvidence?: (evidence: ClaudeBindingEvidence) => void,
    private readonly closeBinding?: (credential: object) => void,
  ) {
    this.roots = claudeTranscriptRoots(configDirectories)
  }

  observe(
    sessionId: string,
    envelope: ClaudeHookEnvelope,
    context: PrivateHookContext,
  ): boolean | 'deferred' | 'state_only' {
    if (this.disposed || !context.isCurrent()) {
      return false
    }
    this.credential = context.credential ?? this
    let decision:
      | { action: 'start' | 'end' | 'event' | 'ignore'; generation: number; deferred?: boolean }
      | undefined
    const lifecycle = this.lifecycle
    this.emit({
      sessionId,
      incarnation: context.incarnation,
      providerSessionId: envelope.claudeSessionId,
      generation: 0,
      fileIdentity: '',
      position: -1,
      baseline: false,
      conversation: {
        get initialState() {
          return lifecycle.checkpoint()
        },
        event: envelope,
        publish: (acceptedGeneration, action = 'event', legacyState = false) => {
          if (this.disposed || !context.isCurrent()) {
            return
          }
          if (action !== 'ignore') {
            this.lifecycle.accept(envelope)
          }
          if (
            this.commit(sessionId, envelope, context, action, acceptedGeneration, legacyState) ||
            legacyState
          ) {
            context.publishState?.(acceptedGeneration)
          }
        },
        decide: value => {
          decision = value
        },
      },
    })
    if (decision?.deferred) {
      return 'deferred'
    }
    const accepted = this.commit(
      sessionId,
      envelope,
      context,
      decision?.action ?? this.lifecycle.accept(envelope),
      decision?.generation,
    )
    return decision ? accepted : accepted || 'state_only'
  }
  private commit(
    sessionId: string,
    envelope: ClaudeHookEnvelope,
    context: PrivateHookContext,
    action: 'start' | 'end' | 'event' | 'ignore',
    acceptedGeneration?: number,
    legacyState = false,
  ): boolean {
    if (this.disposed || !context.isCurrent()) {
      return false
    }
    if (acceptedGeneration !== undefined) {
      setPromptSubmissionEvidence(envelope, {
        ...envelope,
        conversationGeneration: acceptedGeneration,
      })
    }
    this.bindingEvidence?.({
      sessionId,
      credential: context.credential ?? this,
      incarnation: context.incarnation,
      isCurrent: context.isCurrent,
      configDirectories: this.configDirectories,
      event: envelope,
      action,
    })
    const delayedStart =
      acceptedGeneration === undefined &&
      envelope.hookEventName === 'SessionStart' &&
      envelope.emittedAtMs !== undefined &&
      (this.earlySubmits.get(envelope.claudeSessionId) ?? -Infinity) > envelope.emittedAtMs
    if (
      acceptedGeneration === undefined &&
      envelope.hookEventName === 'UserPromptSubmit' &&
      envelope.emittedAtMs !== undefined
    ) {
      if (this.earlySubmits.size >= 16) {
        this.earlySubmits.delete(this.earlySubmits.keys().next().value!)
      }
      this.earlySubmits.set(envelope.claudeSessionId, envelope.emittedAtMs)
    }
    if (action === 'ignore') {
      return false
    }
    this.hotUntil = Date.now() + 2_000
    context = {
      ...context,
      conversationGeneration:
        acceptedGeneration ?? getPromptSubmissionEvidence(envelope)?.conversationGeneration,
    }
    if (action === 'start' || action === 'end') {
      this.detach()
      this.demand = false
      this.currentGeneration = ++generation
      if ((acceptedGeneration === undefined && !delayedStart) || legacyState) {
        this.emit({
          sessionId,
          providerSessionId: envelope.claudeSessionId,
          incarnation: context.incarnation,
          generation: this.currentGeneration,
          conversationGeneration: context.conversationGeneration,
          fileIdentity: `generation:${this.currentGeneration}`,
          position: -1,
          baseline: false,
          origin: 'hook',
          lifecycle: action,
          setPollingDemand: this.pollingDemand(context, this.version),
        })
      }
      if (action === 'end') {
        return true
      }
    }
    if (!envelope.transcriptPath) {
      this.detach()
      this.unavailable(
        sessionId,
        envelope.claudeSessionId,
        context,
        this.currentGeneration || ++generation,
      )
      return true
    }
    if (this.path !== envelope.transcriptPath) {
      if (this.path) {
        this.detach()
      }
      this.path = envelope.transcriptPath
    }
    if (this.watcher) {
      this.watcher.refresh()
    } else if (!this.pending && !this.retry) {
      const bound = {
        incarnation: context.incarnation,
        isCurrent: context.isCurrent,
        conversationGeneration: context.conversationGeneration,
      }
      void this.attach(
        sessionId,
        envelope.claudeSessionId,
        bound,
        this.version,
        this.currentGeneration || (this.currentGeneration = ++generation),
      )
    }
    return true
  }
  private valid(context: PrivateHookContext, version: number): boolean {
    return !this.disposed && this.version === version && context.isCurrent()
  }
  private async attach(
    sessionId: string,
    providerSessionId: string,
    context: PrivateHookContext,
    version: number,
    current: number,
  ): Promise<void> {
    if (!this.valid(context, version) || !this.path) {
      return
    }
    this.pending = true
    const access = claudeTranscriptAccess(this.path, providerSessionId, this.roots)
    try {
      await access.validate()
      if (!this.valid(context, version)) {
        return
      }
      const startedAt = Date.now()
      const watcher = new SessionTurnStateWatcher({
        provider: 'claude-code',
        sessionId,
        filePath: this.path,
        fileAccess: access,
        pollIntervalMs: 250,
        shouldPoll: () =>
          this.valid(context, version) && (this.demand || Date.now() < this.hotUntil),
        checkpoint: true,
        onState: () => {},
        onClaudeTranscript: record => {
          if (!this.valid(context, version) || this.watcher !== watcher) {
            return
          }
          debugAgentContinuation('watch_record', {
            sessionId,
            generation: current,
            position: record.position,
            kind: record.record?.kind,
            baseline: record.baseline,
            elapsedMs: Date.now() - startedAt,
          })
          this.emit({
            ...record,
            sessionId,
            providerSessionId,
            generation: current,
            conversationGeneration: context.conversationGeneration,
            origin: 'hook',
            incarnation: context.incarnation,
            setPollingDemand: this.pollingDemand(context, version),
          })
        },
        onError: () => {
          if (this.valid(context, version) && this.watcher === watcher) {
            this.unavailable(sessionId, providerSessionId, context, current)
          }
        },
      })
      this.watcher = watcher
      debugAgentContinuation('watch_attach', { sessionId, providerSessionId, generation: current })
      watcher.start()
    } catch (error) {
      if (!this.valid(context, version)) {
        return
      }
      this.unavailable(sessionId, providerSessionId, context, current)
      if (
        (error as NodeJS.ErrnoException)?.code === 'ENOENT' &&
        (this.demand || Date.now() < this.hotUntil)
      ) {
        this.retry = setTimeout(() => {
          this.retry = undefined
          void this.attach(sessionId, providerSessionId, context, version, current)
        }, 250)
        this.retry.unref?.()
      }
    } finally {
      if (this.version === version) {
        this.pending = false
      }
    }
  }
  private unavailable(
    sessionId: string,
    providerSessionId: string,
    context: PrivateHookContext,
    current: number,
  ): void {
    if (!context.isCurrent() || this.disposed) {
      return
    }
    debugAgentContinuation('watch_unavailable', { sessionId, generation: current })
    this.emit({
      sessionId,
      providerSessionId,
      generation: current,
      conversationGeneration: context.conversationGeneration,
      origin: 'hook',
      incarnation: context.incarnation,
      fileIdentity: `unavailable:${current}`,
      position: ++this.unavailablePosition,
      baseline: false,
      unavailable: true,
      setPollingDemand: this.pollingDemand(context, this.version),
    })
  }
  private pollingDemand(context: PrivateHookContext, version: number): (needed: boolean) => void {
    return needed => {
      if (this.valid(context, version)) {
        this.demand = needed
      }
    }
  }
  private detach(): void {
    this.version++
    this.pending = false
    this.path = undefined
    if (this.retry) {
      clearTimeout(this.retry)
    }
    this.retry = undefined
    this.watcher?.dispose()
    this.watcher = undefined
  }
  dispose(): void {
    if (this.credential) {
      this.closeBinding?.(this.credential)
    }
    this.disposed = true
    this.detach()
  }
}
