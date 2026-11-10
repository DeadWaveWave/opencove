import type { AppErrorCode } from '../../../shared/contracts/dto'
import type { ControlSurfaceOperationKind } from '../../../shared/contracts/controlSurface'

export interface ControlSurfaceContext {
  readonly managedClaudeIntent?: import('../../../shared/contracts/managedClaudeLaunch').ManagedClaudeLaunchIntent
  readonly managedClaudePreparation?: {
    awaitPending: (nodeId: string) => Promise<void>
    reserve: (
      nodeId: string,
    ) => import('../../../contexts/agent/application/managedClaudeLaunch/types').ManagedClaudeLaunchAttempt
    attempts: Map<
      string,
      import('../../../contexts/agent/application/managedClaudeLaunch/types').ManagedClaudeLaunchAttempt
    >
    run: <T>(
      attempt: import('../../../contexts/agent/application/managedClaudeLaunch/types').ManagedClaudeLaunchAttempt,
      execute: () => Promise<T>,
    ) => Promise<T>
  }
  readonly spawnIdentity?: import('./sessionSpawnIdentityContext').CanvasSpawnIdentity
  readonly requestAuth?: import('./http/requestAuth').RequestAuth
  /** In-process caller lifecycle fence; never accepted from a transport payload. */
  readonly signal?: AbortSignal
  readonly assertActive?: () => void
  /** In-process spawn handoff; never accepted from a transport payload. */
  readonly terminalSpawnLifecycle?: {
    assertActive(): void
    onSpawned(sessionId: string): void
  }
  readonly validateNodeTarget?: (
    target: import('../../../contexts/workspace/application/nodeControl/nodeCreationTarget').ResolvedNodeCreationTarget,
  ) => Promise<void>
  readonly now: () => Date
  readonly terminalRecoverySpawnScope?: unknown
  readonly capabilities: {
    webShell: boolean
    sync: {
      state: boolean
      events: boolean
    }
    sessionStreaming: {
      enabled: boolean
      ptyProtocolVersion: number
      replayWindowMaxBytes: number
      roles: {
        viewer: boolean
        controller: boolean
      }
      webAuth: {
        ticketToCookie: boolean
        cookieSession: boolean
      }
    }
  }
}

export type ControlSurfacePayloadValidator<TPayload> = (payload: unknown) => TPayload

export interface ControlSurfaceHandler<TPayload, TResult> {
  kind: ControlSurfaceOperationKind
  validate: ControlSurfacePayloadValidator<TPayload>
  handle: (ctx: ControlSurfaceContext, payload: TPayload) => Promise<TResult> | TResult
  defaultErrorCode: AppErrorCode
}
