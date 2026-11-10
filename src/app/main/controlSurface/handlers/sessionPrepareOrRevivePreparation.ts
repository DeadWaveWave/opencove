import { resolvePreparationAgentBinding } from './sessionPrepareOrReviveAgentBinding'
import {
  withManagedClaudeFallback,
  rethrowManagedClaudeLaunchError,
  assertManagedClaudeLaunchCurrent,
} from '../managedClaudeLaunchRuntime'
import { ABSENT_MANAGED_CLAUDE_BINDING } from '../../../../shared/contracts/managedClaudeLaunch'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import {
  isResumeSessionBindingVerified,
  resolveLaunchedAgentResumeBinding,
} from '../../../../contexts/agent/domain/agentResumeBinding'
import { resolveInitialAgentRuntimeStatus } from '../../../../contexts/agent/domain/agentRuntimeStatus'
import {
  normalizeAgentSettings,
  resolveAgentLaunchEnv,
} from '../../../../contexts/settings/domain/agentSettings'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  LaunchAgentSessionResult,
  PreparedRuntimeNodeResult,
} from '../../../../shared/contracts/dto'
import { isRemoteNodeWorkerBinding } from '../../../../shared/types/nodeWorkerBinding'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import {
  formatRecoverableError,
  invokeCommand,
  isActiveAgentStatus,
  isRecoverableAgentWindowStatus,
  resolveNodeProfileId,
  resolveNodeRuntimeKind,
  toPreparedNodeResult,
  type NormalizedPersistedNode,
  type NormalizedPersistedSpace,
  type NormalizedPersistedWorkspace,
  type PersistedAgentLike,
} from './sessionPrepareOrReviveShared'
import {
  resolvePrepareOrReviveLaunchContext,
  spawnFallbackTerminal,
} from './sessionPrepareOrReviveTerminalSpawn'
import { resolveNodeInitialPtyGeometry } from './sessionPrepareOrReviveGeometry'
import {
  CodexWriterLockRecoveryExhaustedError,
  launchCodexResumeWithRecovery,
} from './sessionPrepareOrReviveCodex'
export { resolveNodeInitialPtyGeometry } from './sessionPrepareOrReviveGeometry'
export { resolvePrepareOrReviveResumeLocateTimeoutMs } from './sessionPrepareOrReviveResumeBinding'
export { prepareTerminalNode } from './sessionPrepareOrReviveTerminalPreparation'

export async function prepareAgentNode(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  store: PersistenceStore
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
  agent: PersistedAgentLike
  settings: ReturnType<typeof normalizeAgentSettings>
  ptyRuntime?: Pick<ControlSurfacePtyRuntime, 'onData' | 'onExit' | 'kill'>
}): Promise<PreparedRuntimeNodeResult> {
  const { controlSurface, ctx, workspace, node, space, settings } = options
  const binding = options.store.observeManagedClaudeNode?.(node.id).binding
  if (binding) {
    options = { ...options, agent: { ...options.agent, ...binding.tuple } }
  }
  const scrollback: string | null = null
  const terminalProfileId = resolveNodeProfileId(node) ?? settings.defaultTerminalProfileId ?? null
  const initialGeometry = resolveNodeInitialPtyGeometry(node, settings, options.agent.provider)
  const workspaceEnv = workspace.environmentVariables
  const agentEnv = resolveAgentLaunchEnv(settings, options.agent.provider)
  const mergedEnv =
    Object.keys(workspaceEnv).length > 0 ? { ...agentEnv, ...workspaceEnv } : agentEnv
  const hasActiveStatus = isActiveAgentStatus(node.status)
  const hasRecoverableStatus = isRecoverableAgentWindowStatus(node.status)
  const sanitizedAgent = await resolvePreparationAgentBinding(
    node,
    options.agent,
    hasRecoverableStatus,
    Boolean(binding),
  )
  const shouldAutoResumeAgent =
    hasRecoverableStatus && isResumeSessionBindingVerified(sanitizedAgent)
  const shouldRelaunchBlankAgent =
    !binding &&
    hasRecoverableStatus &&
    !isResumeSessionBindingVerified(sanitizedAgent) &&
    sanitizedAgent.prompt.trim().length === 0
  const agentLaunchContext = await resolvePrepareOrReviveLaunchContext({
    controlSurface,
    ctx,
    workspace,
    node,
    space,
    cwd: sanitizedAgent.executionDirectory,
  })
  assertManagedClaudeLaunchCurrent()
  const agentExecutionDirectory = agentLaunchContext.workingDirectory
  const agentExpectedDirectory = agentLaunchContext.workingDirectory

  if (agentLaunchContext.resolution === 'unresolved_remote') {
    return toPreparedNodeResult(node, {
      recoveryState: 'fallback_terminal',
      sessionId: '',
      isLiveSessionReattach: false,
      profileId: terminalProfileId,
      runtimeKind: resolveNodeRuntimeKind(node),
      status: hasActiveStatus ? 'standby' : node.status,
      startedAt: node.startedAt,
      endedAt: null,
      exitCode: node.exitCode,
      lastError: null,
      recoveryIssue: 'remote_worker_unavailable',
      scrollback,
      terminalGeometry: node.terminalGeometry,
      workerBinding: binding ? node.workerBinding : agentLaunchContext.workerBinding,
      executionDirectory: agentExecutionDirectory,
      expectedDirectory: agentExpectedDirectory,
      agent: {
        ...sanitizedAgent,
        executionDirectory: agentExecutionDirectory,
        expectedDirectory: agentExpectedDirectory,
      },
    })
  }
  const isRemoteLaunchContext = isRemoteNodeWorkerBinding(agentLaunchContext.workerBinding)

  const invokeAgentLaunch = async (mode: 'new' | 'resume'): Promise<LaunchAgentSessionResult> => {
    if (agentLaunchContext.mountId) {
      return await invokeCommand<LaunchAgentSessionResult>(
        controlSurface,
        {
          ...ctx,
          spawnIdentity: { projectId: workspace.id, spaceId: space?.id ?? '', nodeId: node.id },
        },
        {
          id: 'session.launchAgentInMount',
          payload: {
            ...(sanitizedAgent.provider === 'claude-code' && !isRemoteLaunchContext
              ? {
                  intent:
                    binding || mode === 'resume'
                      ? { kind: 'resumeCurrent' }
                      : { kind: 'launchNew', expected: ABSENT_MANAGED_CLAUDE_BINDING },
                }
              : {}),
            mountId: agentLaunchContext.mountId,
            cwdUri: toFileUri(agentExecutionDirectory),
            prompt: sanitizedAgent.prompt,
            provider: sanitizedAgent.provider,
            mode,
            model: sanitizedAgent.model,
            resumeSessionId: mode === 'resume' ? sanitizedAgent.resumeSessionId : null,
            ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
            agentFullAccess: settings.agentFullAccess,
            codexReuseRunningAppServer: settings.codexReuseRunningAppServer,
            cols: initialGeometry.cols,
            rows: initialGeometry.rows,
          },
        },
      )
    }

    return await invokeCommand<LaunchAgentSessionResult>(
      controlSurface,
      {
        ...ctx,
        spawnIdentity: { projectId: workspace.id, spaceId: space?.id ?? '', nodeId: node.id },
      },
      {
        id: 'session.launchAgent',
        payload: {
          ...(sanitizedAgent.provider === 'claude-code' && !isRemoteLaunchContext
            ? {
                intent:
                  binding || mode === 'resume'
                    ? { kind: 'resumeCurrent' }
                    : { kind: 'launchNew', expected: ABSENT_MANAGED_CLAUDE_BINDING },
              }
            : {}),
          cwd: agentExecutionDirectory,
          prompt: sanitizedAgent.prompt,
          provider: sanitizedAgent.provider,
          mode,
          model: sanitizedAgent.model,
          resumeSessionId: mode === 'resume' ? sanitizedAgent.resumeSessionId : null,
          ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
          agentFullAccess: settings.agentFullAccess,
          codexReuseRunningAppServer: settings.codexReuseRunningAppServer,
          cols: initialGeometry.cols,
          rows: initialGeometry.rows,
        },
      },
    )
  }

  const spawnFallback = () =>
    withManagedClaudeFallback(() =>
      spawnFallbackTerminal({
        controlSurface,
        ctx,
        workspace,
        node,
        space,
        cwd: agentExecutionDirectory,
        profileId: terminalProfileId,
        geometry: initialGeometry,
        launchContext: agentLaunchContext,
      }),
    )

  if (shouldAutoResumeAgent) {
    try {
      const launched =
        sanitizedAgent.provider === 'codex'
          ? await launchCodexResumeWithRecovery({
              resumeSessionId: sanitizedAgent.resumeSessionId!,
              isLocalRuntime: agentLaunchContext.endpointId === 'local',
              launch: async () => await invokeAgentLaunch('resume'),
              ...(options.ptyRuntime ? { ptyRuntime: options.ptyRuntime } : {}),
            })
          : await invokeAgentLaunch('resume')
      const ownsNode = binding || launched.managedClaudeLifecycle?.binding.nodeSeen
      return toPreparedNodeResult(node, {
        ...(launched.managedClaudeLifecycle
          ? {
              managedClaudeLifecycle: launched.managedClaudeLifecycle,
              managedClaudeBinding: launched.managedClaudeLifecycle.binding,
            }
          : {}),
        recoveryState: 'revived',
        sessionId: launched.sessionId,
        isLiveSessionReattach: false,
        profileId: launched.profileId !== undefined ? launched.profileId : terminalProfileId,
        runtimeKind:
          launched.runtimeKind !== undefined ? launched.runtimeKind : resolveNodeRuntimeKind(node),
        status: 'standby',
        startedAt: node.startedAt,
        endedAt: null,
        exitCode: null,
        lastError: null,
        recoveryIssue: null,
        scrollback,
        terminalGeometry: initialGeometry,
        workerBinding: ownsNode ? node.workerBinding : agentLaunchContext.workerBinding,
        executionDirectory: agentExecutionDirectory,
        expectedDirectory: agentExpectedDirectory,
        agent: {
          ...sanitizedAgent,
          executionDirectory: agentExecutionDirectory,
          expectedDirectory: agentExpectedDirectory,
          effectiveModel: launched.effectiveModel,
          launchMode: 'resume',
          ...(launched.managedClaudeLifecycle?.binding.tuple ?? {
            resumeSessionId: sanitizedAgent.resumeSessionId,
            resumeSessionIdVerified: true,
          }),
        },
      })
    } catch (error) {
      rethrowManagedClaudeLaunchError(error)
      const isWriterLockConflict = error instanceof CodexWriterLockRecoveryExhaustedError
      try {
        const spawned = await spawnFallback()
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: spawned.sessionId,
          ...('managedClaudeLifecycle' in spawned
            ? {
                managedClaudeLifecycle: spawned.managedClaudeLifecycle,
                managedClaudeBinding: spawned.managedClaudeBinding,
              }
            : {}),
          isLiveSessionReattach: false,
          profileId: spawned.profileId ?? terminalProfileId,
          runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(node),
          status: isWriterLockConflict ? 'standby' : 'failed',
          startedAt: node.startedAt,
          endedAt: isWriterLockConflict ? null : (node.endedAt ?? ctx.now().toISOString()),
          exitCode: node.exitCode,
          lastError: isWriterLockConflict
            ? null
            : formatRecoverableError('Agent resume failed', error),
          recoveryIssue: isWriterLockConflict ? 'codex_writer_locked' : null,
          scrollback,
          terminalGeometry: initialGeometry,
          workerBinding: binding ? node.workerBinding : spawned.workerBinding,
          executionDirectory: spawned.cwd,
          expectedDirectory: spawned.cwd,
          agent: {
            ...sanitizedAgent,
            executionDirectory: spawned.cwd,
            expectedDirectory: spawned.cwd,
          },
        })
      } catch (fallbackError) {
        rethrowManagedClaudeLaunchError(fallbackError)
        const remoteUnavailable = isRemoteLaunchContext && !isWriterLockConflict
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: '',
          isLiveSessionReattach: false,
          profileId: terminalProfileId,
          runtimeKind: resolveNodeRuntimeKind(node),
          status: isWriterLockConflict || remoteUnavailable ? 'standby' : 'failed',
          startedAt: node.startedAt,
          endedAt: isWriterLockConflict || remoteUnavailable ? null : ctx.now().toISOString(),
          exitCode: node.exitCode,
          lastError:
            isWriterLockConflict || remoteUnavailable
              ? null
              : formatRecoverableError('Agent resume failed', fallbackError),
          recoveryIssue: isWriterLockConflict
            ? 'codex_writer_locked'
            : remoteUnavailable
              ? 'remote_worker_unavailable'
              : null,
          scrollback,
          terminalGeometry: node.terminalGeometry,
          workerBinding: binding ? node.workerBinding : agentLaunchContext.workerBinding,
          executionDirectory: agentExecutionDirectory,
          expectedDirectory: agentExpectedDirectory,
          agent: {
            ...sanitizedAgent,
            executionDirectory: agentExecutionDirectory,
            expectedDirectory: agentExpectedDirectory,
          },
        })
      }
    }
  }

  if (shouldRelaunchBlankAgent) {
    try {
      const launched = await invokeAgentLaunch('new')
      const ownsNode = binding || launched.managedClaudeLifecycle?.binding.nodeSeen
      return toPreparedNodeResult(node, {
        ...(launched.managedClaudeLifecycle
          ? {
              managedClaudeLifecycle: launched.managedClaudeLifecycle,
              managedClaudeBinding: launched.managedClaudeLifecycle.binding,
            }
          : {}),
        recoveryState: 'restarted',
        sessionId: launched.sessionId,
        isLiveSessionReattach: false,
        profileId: launched.profileId !== undefined ? launched.profileId : terminalProfileId,
        runtimeKind:
          launched.runtimeKind !== undefined ? launched.runtimeKind : resolveNodeRuntimeKind(node),
        status: resolveInitialAgentRuntimeStatus(sanitizedAgent.prompt),
        startedAt: ctx.now().toISOString(),
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback,
        terminalGeometry: initialGeometry,
        workerBinding: ownsNode ? node.workerBinding : agentLaunchContext.workerBinding,
        executionDirectory: agentExecutionDirectory,
        expectedDirectory: agentExpectedDirectory,
        agent: {
          ...sanitizedAgent,
          executionDirectory: agentExecutionDirectory,
          expectedDirectory: agentExpectedDirectory,
          effectiveModel: launched.effectiveModel,
          launchMode: 'new',
          ...resolveLaunchedAgentResumeBinding(
            sanitizedAgent.provider,
            'new',
            launched.resumeSessionId,
          ),
        },
      })
    } catch (error) {
      rethrowManagedClaudeLaunchError(error)
      try {
        const spawned = await spawnFallback()
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: spawned.sessionId,
          ...('managedClaudeLifecycle' in spawned
            ? {
                managedClaudeLifecycle: spawned.managedClaudeLifecycle,
                managedClaudeBinding: spawned.managedClaudeBinding,
              }
            : {}),
          isLiveSessionReattach: false,
          profileId: spawned.profileId ?? terminalProfileId,
          runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(node),
          status: 'failed',
          startedAt: node.startedAt,
          endedAt: ctx.now().toISOString(),
          exitCode: null,
          lastError: formatRecoverableError('Agent launch failed', error),
          scrollback,
          terminalGeometry: initialGeometry,
          workerBinding: binding ? node.workerBinding : spawned.workerBinding,
          executionDirectory: spawned.cwd,
          expectedDirectory: spawned.cwd,
          agent: {
            ...sanitizedAgent,
            executionDirectory: spawned.cwd,
            expectedDirectory: spawned.cwd,
          },
        })
      } catch (fallbackError) {
        rethrowManagedClaudeLaunchError(fallbackError)
        return toPreparedNodeResult(node, {
          recoveryState: 'fallback_terminal',
          sessionId: '',
          isLiveSessionReattach: false,
          profileId: terminalProfileId,
          runtimeKind: resolveNodeRuntimeKind(node),
          status: isRemoteLaunchContext ? 'standby' : 'failed',
          startedAt: node.startedAt,
          endedAt: isRemoteLaunchContext ? null : ctx.now().toISOString(),
          exitCode: null,
          lastError: isRemoteLaunchContext
            ? null
            : formatRecoverableError('Agent launch failed', fallbackError),
          recoveryIssue: isRemoteLaunchContext ? 'remote_worker_unavailable' : null,
          scrollback,
          terminalGeometry: node.terminalGeometry,
          workerBinding: binding ? node.workerBinding : agentLaunchContext.workerBinding,
          executionDirectory: agentExecutionDirectory,
          expectedDirectory: agentExpectedDirectory,
          agent: {
            ...sanitizedAgent,
            executionDirectory: agentExecutionDirectory,
            expectedDirectory: agentExpectedDirectory,
          },
        })
      }
    }
  }

  try {
    const spawned = await spawnFallback()
    return toPreparedNodeResult(node, {
      recoveryState: 'fallback_terminal',
      sessionId: spawned.sessionId,
      ...('managedClaudeLifecycle' in spawned
        ? {
            managedClaudeLifecycle: spawned.managedClaudeLifecycle,
            managedClaudeBinding: spawned.managedClaudeBinding,
          }
        : {}),
      isLiveSessionReattach: false,
      profileId: spawned.profileId ?? terminalProfileId,
      runtimeKind: spawned.runtimeKind ?? resolveNodeRuntimeKind(node),
      status: hasActiveStatus ? 'stopped' : node.status,
      startedAt: node.startedAt,
      endedAt: hasActiveStatus ? (node.endedAt ?? ctx.now().toISOString()) : node.endedAt,
      exitCode: node.exitCode,
      lastError: null,
      scrollback,
      terminalGeometry: initialGeometry,
      workerBinding: binding ? node.workerBinding : spawned.workerBinding,
      executionDirectory: spawned.cwd,
      expectedDirectory: spawned.cwd,
      agent: {
        ...sanitizedAgent,
        executionDirectory: spawned.cwd,
        expectedDirectory: spawned.cwd,
      },
    })
  } catch (error) {
    rethrowManagedClaudeLaunchError(error)
    return toPreparedNodeResult(node, {
      recoveryState: 'fallback_terminal',
      sessionId: '',
      isLiveSessionReattach: false,
      profileId: terminalProfileId,
      runtimeKind: resolveNodeRuntimeKind(node),
      status: isRemoteLaunchContext ? 'standby' : 'failed',
      startedAt: node.startedAt,
      endedAt: isRemoteLaunchContext ? null : ctx.now().toISOString(),
      exitCode: null,
      lastError: isRemoteLaunchContext
        ? null
        : formatRecoverableError('Terminal launch failed', error),
      recoveryIssue: isRemoteLaunchContext ? 'remote_worker_unavailable' : null,
      scrollback,
      terminalGeometry: node.terminalGeometry,
      workerBinding: binding ? node.workerBinding : agentLaunchContext.workerBinding,
      executionDirectory: agentExecutionDirectory,
      expectedDirectory: agentExpectedDirectory,
      agent: {
        ...sanitizedAgent,
        executionDirectory: agentExecutionDirectory,
        expectedDirectory: agentExpectedDirectory,
      },
    })
  }
}
