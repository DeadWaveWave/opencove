import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
} from '../../../../contexts/agent/domain/agentResumeBinding'
import { locateAgentResumeSessionId } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocator'
import { resolveInitialAgentRuntimeStatus } from '../../../../contexts/agent/domain/agentRuntimeStatus'
import {
  normalizeAgentSettings,
  resolveAgentLaunchEnv,
} from '../../../../contexts/settings/domain/agentSettings'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  LaunchAgentSessionResult,
  PreparedRuntimeNodeResult,
  SpawnTerminalResult,
} from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import { normalizeOptionalString } from './sessionLaunchPayloadSupport'
import {
  formatRecoverableError,
  invokeCommand,
  isActiveAgentStatus,
  resolveNodeProfileId,
  resolvePreparedScrollback,
  resolveNodeRuntimeKind,
  resolveTerminalRecoveryCwd,
  toPreparedNodeResult,
  type NormalizedPersistedNode,
  type NormalizedPersistedSpace,
  type NormalizedPersistedWorkspace,
  type PersistedAgentLike,
} from './sessionPrepareOrReviveShared'

const RESUME_SESSION_LOCATE_TIMEOUT_MS = 3_000
const DEFAULT_PTY_COLS = 80
const DEFAULT_PTY_ROWS = 24
const TERMINAL_NODE_HEADER_HEIGHT_PX = 34
const TERMINAL_NODE_XTERM_PADDING_PX = 16
const ESTIMATED_TERMINAL_CELL_WIDTH_RATIO = 0.6
const ESTIMATED_TERMINAL_CELL_HEIGHT_RATIO = 1.15

type PtyGeometry = { cols: number; rows: number }

async function resolvePendingResumeSessionId(
  node: NormalizedPersistedNode,
  agent: PersistedAgentLike,
): Promise<string | null> {
  if (!isActiveAgentStatus(node.status)) {
    return null
  }

  if (typeof node.startedAt !== 'string' || node.startedAt.trim().length === 0) {
    return null
  }

  if (isResumeSessionBindingVerified(agent)) {
    return agent.resumeSessionId
  }

  return await locateAgentResumeSessionId({
    provider: agent.provider,
    cwd: agent.executionDirectory,
    startedAtMs: Date.parse(node.startedAt),
    timeoutMs: RESUME_SESSION_LOCATE_TIMEOUT_MS,
  })
}

function clampPtyDimension(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)
  if (normalized <= 0) {
    return fallback
  }

  return Math.min(max, Math.max(1, normalized))
}

export function resolveNodeInitialPtyGeometry(
  node: NormalizedPersistedNode,
  settings: ReturnType<typeof normalizeAgentSettings>,
): PtyGeometry {
  if (node.terminalGeometry) {
    return node.terminalGeometry
  }

  const fontSize =
    Number.isFinite(settings.terminalFontSize) && settings.terminalFontSize > 0
      ? settings.terminalFontSize
      : 13
  const contentWidth = node.width - TERMINAL_NODE_XTERM_PADDING_PX
  const contentHeight =
    node.height - TERMINAL_NODE_HEADER_HEIGHT_PX - TERMINAL_NODE_XTERM_PADDING_PX
  const cellWidth = fontSize * ESTIMATED_TERMINAL_CELL_WIDTH_RATIO
  const cellHeight = fontSize * ESTIMATED_TERMINAL_CELL_HEIGHT_RATIO

  return {
    cols: clampPtyDimension(contentWidth / cellWidth, DEFAULT_PTY_COLS, 300),
    rows: clampPtyDimension(contentHeight / cellHeight, DEFAULT_PTY_ROWS, 120),
  }
}

async function spawnFallbackTerminal(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
  cwd: string
  profileId: string | null
  geometry?: PtyGeometry
}): Promise<SpawnTerminalResult> {
  const geometry = options.geometry ?? { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS }
  if (options.space?.targetMountId) {
    return await invokeCommand<SpawnTerminalResult>(options.controlSurface, options.ctx, {
      id: 'pty.spawnInMount',
      payload: {
        mountId: options.space.targetMountId,
        cwdUri: toFileUri(options.cwd),
        profileId: options.profileId,
        cols: geometry.cols,
        rows: geometry.rows,
      },
    })
  }

  return await invokeCommand<SpawnTerminalResult>(options.controlSurface, options.ctx, {
    id: 'pty.spawn',
    payload: {
      cwd: options.cwd,
      profileId: options.profileId,
      cols: geometry.cols,
      rows: geometry.rows,
    },
  })
}

export async function prepareTerminalNode(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  store: PersistenceStore
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
}): Promise<PreparedRuntimeNodeResult> {
  const cwd = resolveTerminalRecoveryCwd(options.node, options.workspace.path)
  const scrollback = await resolvePreparedScrollback({
    store: options.store,
    node: options.node,
  })
  try {
    const spawned = await spawnFallbackTerminal({
      controlSurface: options.controlSurface,
      ctx: options.ctx,
      workspace: options.workspace,
      node: options.node,
      space: options.space,
      cwd,
      profileId: resolveNodeProfileId(options.node),
    })

    return toPreparedNodeResult(options.node, {
      recoveryState: 'restarted',
      sessionId: spawned.sessionId,
      isLiveSessionReattach: false,
      profileId: spawned.profileId ?? resolveNodeProfileId(options.node),
      runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(options.node),
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback,
      executionDirectory: normalizeOptionalString(options.node.executionDirectory),
      expectedDirectory: normalizeOptionalString(options.node.expectedDirectory),
      agent: null,
    })
  } catch (error) {
    return toPreparedNodeResult(options.node, {
      recoveryState: 'restarted',
      sessionId: '',
      isLiveSessionReattach: false,
      profileId: resolveNodeProfileId(options.node),
      runtimeKind: resolveNodeRuntimeKind(options.node),
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: formatRecoverableError('Terminal launch failed', error),
      scrollback,
      executionDirectory: normalizeOptionalString(options.node.executionDirectory),
      expectedDirectory: normalizeOptionalString(options.node.expectedDirectory),
      agent: null,
    })
  }
}

export async function prepareAgentNode(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  store: PersistenceStore
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
  agent: PersistedAgentLike
  settings: ReturnType<typeof normalizeAgentSettings>
}): Promise<PreparedRuntimeNodeResult> {
  const { controlSurface, ctx, workspace, node, space, settings } = options
  const scrollback: string | null = null
  const terminalProfileId = resolveNodeProfileId(node) ?? settings.defaultTerminalProfileId ?? null
  const initialGeometry = resolveNodeInitialPtyGeometry(node, settings)
  const workspaceEnv = workspace.environmentVariables
  const agentEnv = resolveAgentLaunchEnv(settings, options.agent.provider)
  const mergedEnv =
    Object.keys(workspaceEnv).length > 0 ? { ...agentEnv, ...workspaceEnv } : agentEnv
  const hasActiveStatus = isActiveAgentStatus(node.status)
  const resolvedPendingResumeSessionId =
    hasActiveStatus && !isResumeSessionBindingVerified(options.agent)
      ? await resolvePendingResumeSessionId(node, options.agent)
      : null
  const sanitizedAgent = resolvedPendingResumeSessionId
    ? {
        ...options.agent,
        resumeSessionId: resolvedPendingResumeSessionId,
        resumeSessionIdVerified: true,
      }
    : isResumeSessionBindingVerified(options.agent)
      ? options.agent
      : {
          ...options.agent,
          ...clearResumeSessionBinding(),
        }
  const shouldAutoResumeAgent = hasActiveStatus && isResumeSessionBindingVerified(sanitizedAgent)
  const shouldRelaunchBlankAgent =
    hasActiveStatus &&
    !isResumeSessionBindingVerified(sanitizedAgent) &&
    sanitizedAgent.prompt.trim().length === 0

  const invokeAgentLaunch = async (mode: 'new' | 'resume'): Promise<LaunchAgentSessionResult> => {
    if (space?.targetMountId) {
      return await invokeCommand<LaunchAgentSessionResult>(controlSurface, ctx, {
        id: 'session.launchAgentInMount',
        payload: {
          mountId: space.targetMountId,
          cwdUri: toFileUri(sanitizedAgent.executionDirectory),
          prompt: sanitizedAgent.prompt,
          provider: sanitizedAgent.provider,
          mode,
          model: sanitizedAgent.model,
          resumeSessionId: mode === 'resume' ? sanitizedAgent.resumeSessionId : null,
          ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
          agentFullAccess: settings.agentFullAccess,
          cols: initialGeometry.cols,
          rows: initialGeometry.rows,
        },
      })
    }

    return await invokeCommand<LaunchAgentSessionResult>(controlSurface, ctx, {
      id: 'session.launchAgent',
      payload: {
        cwd: sanitizedAgent.executionDirectory,
        prompt: sanitizedAgent.prompt,
        provider: sanitizedAgent.provider,
        mode,
        model: sanitizedAgent.model,
        resumeSessionId: mode === 'resume' ? sanitizedAgent.resumeSessionId : null,
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
        agentFullAccess: settings.agentFullAccess,
        cols: initialGeometry.cols,
        rows: initialGeometry.rows,
      },
    })
  }

  if (shouldAutoResumeAgent) {
    try {
      const launched = await invokeAgentLaunch('resume')
      return toPreparedNodeResult(node, {
        recoveryState: 'revived',
        sessionId: launched.sessionId,
        isLiveSessionReattach: false,
        profileId: terminalProfileId,
        runtimeKind: 'posix',
        status: 'standby',
        startedAt: node.startedAt,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback,
        executionDirectory: sanitizedAgent.executionDirectory,
        expectedDirectory: sanitizedAgent.expectedDirectory,
        agent: {
          ...sanitizedAgent,
          effectiveModel: launched.effectiveModel,
          launchMode: 'resume',
          resumeSessionId: launched.resumeSessionId ?? sanitizedAgent.resumeSessionId,
          resumeSessionIdVerified: true,
        },
      })
    } catch (error) {
      try {
        const spawned = await spawnFallbackTerminal({
          controlSurface,
          ctx,
          workspace,
          node,
          space,
          cwd: sanitizedAgent.executionDirectory,
          profileId: terminalProfileId,
          geometry: initialGeometry,
        })
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: spawned.sessionId,
          isLiveSessionReattach: false,
          profileId: spawned.profileId ?? terminalProfileId,
          runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(node),
          status: 'failed',
          startedAt: node.startedAt,
          endedAt: node.endedAt ?? ctx.now().toISOString(),
          exitCode: node.exitCode,
          lastError: formatRecoverableError('Agent resume failed', error),
          scrollback,
          executionDirectory: sanitizedAgent.executionDirectory,
          expectedDirectory: sanitizedAgent.expectedDirectory,
          agent: sanitizedAgent,
        })
      } catch (fallbackError) {
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: '',
          isLiveSessionReattach: false,
          profileId: terminalProfileId,
          runtimeKind: resolveNodeRuntimeKind(node),
          status: 'failed',
          startedAt: node.startedAt,
          endedAt: ctx.now().toISOString(),
          exitCode: node.exitCode,
          lastError: formatRecoverableError('Agent resume failed', fallbackError),
          scrollback,
          executionDirectory: sanitizedAgent.executionDirectory,
          expectedDirectory: sanitizedAgent.expectedDirectory,
          agent: sanitizedAgent,
        })
      }
    }
  }

  if (shouldRelaunchBlankAgent) {
    try {
      const launched = await invokeAgentLaunch('new')
      return toPreparedNodeResult(node, {
        recoveryState: 'restarted',
        sessionId: launched.sessionId,
        isLiveSessionReattach: false,
        profileId: terminalProfileId,
        runtimeKind: 'posix',
        status: resolveInitialAgentRuntimeStatus(sanitizedAgent.prompt),
        startedAt: ctx.now().toISOString(),
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback,
        executionDirectory: sanitizedAgent.executionDirectory,
        expectedDirectory: sanitizedAgent.expectedDirectory,
        agent: {
          ...sanitizedAgent,
          effectiveModel: launched.effectiveModel,
          launchMode: 'new',
          ...clearResumeSessionBinding(),
        },
      })
    } catch (error) {
      try {
        const spawned = await spawnFallbackTerminal({
          controlSurface,
          ctx,
          workspace,
          node,
          space,
          cwd: sanitizedAgent.executionDirectory,
          profileId: terminalProfileId,
          geometry: initialGeometry,
        })
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: spawned.sessionId,
          isLiveSessionReattach: false,
          profileId: spawned.profileId ?? terminalProfileId,
          runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(node),
          status: 'failed',
          startedAt: node.startedAt,
          endedAt: ctx.now().toISOString(),
          exitCode: null,
          lastError: formatRecoverableError('Agent launch failed', error),
          scrollback,
          executionDirectory: sanitizedAgent.executionDirectory,
          expectedDirectory: sanitizedAgent.expectedDirectory,
          agent: sanitizedAgent,
        })
      } catch (fallbackError) {
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: '',
          isLiveSessionReattach: false,
          profileId: terminalProfileId,
          runtimeKind: resolveNodeRuntimeKind(node),
          status: 'failed',
          startedAt: node.startedAt,
          endedAt: ctx.now().toISOString(),
          exitCode: null,
          lastError: formatRecoverableError('Agent launch failed', fallbackError),
          scrollback,
          executionDirectory: sanitizedAgent.executionDirectory,
          expectedDirectory: sanitizedAgent.expectedDirectory,
          agent: sanitizedAgent,
        })
      }
    }
  }

  try {
    const spawned = await spawnFallbackTerminal({
      controlSurface,
      ctx,
      workspace,
      node,
      space,
      cwd: sanitizedAgent.executionDirectory,
      profileId: terminalProfileId,
      geometry: initialGeometry,
    })
    return toPreparedNodeResult(node, {
      recoveryState: 'fallback_terminal',
      sessionId: spawned.sessionId,
      isLiveSessionReattach: false,
      profileId: spawned.profileId ?? terminalProfileId,
      runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(node),
      status: hasActiveStatus ? 'stopped' : node.status,
      startedAt: node.startedAt,
      endedAt: hasActiveStatus ? (node.endedAt ?? ctx.now().toISOString()) : node.endedAt,
      exitCode: node.exitCode,
      lastError: null,
      scrollback,
      executionDirectory: sanitizedAgent.executionDirectory,
      expectedDirectory: sanitizedAgent.expectedDirectory,
      agent: sanitizedAgent,
    })
  } catch (error) {
    return toPreparedNodeResult(node, {
      recoveryState: 'fallback_terminal',
      sessionId: '',
      isLiveSessionReattach: false,
      profileId: terminalProfileId,
      runtimeKind: resolveNodeRuntimeKind(node),
      status: 'failed',
      startedAt: node.startedAt,
      endedAt: ctx.now().toISOString(),
      exitCode: null,
      lastError: formatRecoverableError('Terminal launch failed', error),
      scrollback,
      executionDirectory: sanitizedAgent.executionDirectory,
      expectedDirectory: sanitizedAgent.expectedDirectory,
      agent: sanitizedAgent,
    })
  }
}
