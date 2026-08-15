import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { PreparedRuntimeNodeResult } from '../../../../shared/contracts/dto'
import { isRemoteNodeWorkerBinding } from '../../../../shared/types/nodeWorkerBinding'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import { normalizeOptionalString } from './sessionLaunchPayloadSupport'
import {
  formatRecoverableError,
  resolveNodeProfileId,
  resolveNodeRuntimeKind,
  resolvePreparedScrollback,
  resolveTerminalRecoveryCwd,
  toPreparedNodeResult,
  type NormalizedPersistedNode,
  type NormalizedPersistedSpace,
  type NormalizedPersistedWorkspace,
} from './sessionPrepareOrReviveShared'
import { DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS } from './sessionPrepareOrReviveGeometry'
import {
  resolvePrepareOrReviveLaunchContext,
  spawnFallbackTerminal,
} from './sessionPrepareOrReviveTerminalSpawn'
import { reenterTerminalAgent } from './sessionPrepareOrReviveTerminalAgent'

export async function prepareTerminalNode(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  ptyRuntime: Pick<ControlSurfacePtyRuntime, 'waitForShellReady' | 'write'>
  store: PersistenceStore
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
}): Promise<PreparedRuntimeNodeResult> {
  const cwd = resolveTerminalRecoveryCwd(options.node, options.workspace.path)
  const spawnGeometry = options.node.terminalGeometry ?? {
    cols: DEFAULT_PTY_COLS,
    rows: DEFAULT_PTY_ROWS,
  }
  const preparedTerminalGeometry = options.node.terminalGeometry ?? null
  const scrollback = await resolvePreparedScrollback({ store: options.store, node: options.node })
  const launchContext = await resolvePrepareOrReviveLaunchContext({
    controlSurface: options.controlSurface,
    ctx: options.ctx,
    workspace: options.workspace,
    node: options.node,
    space: options.space,
    cwd,
  })
  if (launchContext.resolution === 'unresolved_remote') {
    return toPreparedNodeResult(options.node, {
      recoveryState: 'fallback_terminal',
      sessionId: '',
      isLiveSessionReattach: false,
      profileId: resolveNodeProfileId(options.node),
      runtimeKind: resolveNodeRuntimeKind(options.node),
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      recoveryIssue: 'remote_worker_unavailable',
      scrollback,
      terminalGeometry: options.node.terminalGeometry,
      workerBinding: launchContext.workerBinding,
      executionDirectory: normalizeOptionalString(options.node.executionDirectory),
      expectedDirectory: normalizeOptionalString(options.node.expectedDirectory),
      agent: null,
    })
  }

  try {
    const spawned = await spawnFallbackTerminal({
      controlSurface: options.controlSurface,
      ctx: options.ctx,
      workspace: options.workspace,
      node: options.node,
      space: options.space,
      cwd,
      profileId: resolveNodeProfileId(options.node),
      geometry: spawnGeometry,
      launchContext,
    })
    await reenterTerminalAgent({
      node: options.node,
      sessionId: spawned.sessionId,
      ptyRuntime: options.ptyRuntime,
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
      terminalGeometry: preparedTerminalGeometry,
      workerBinding: spawned.workerBinding,
      executionDirectory: spawned.cwd,
      expectedDirectory: spawned.cwd,
      agent: null,
    })
  } catch (error) {
    const remoteUnavailable = isRemoteNodeWorkerBinding(launchContext.workerBinding)
    return toPreparedNodeResult(options.node, {
      recoveryState: remoteUnavailable ? 'fallback_terminal' : 'restarted',
      sessionId: '',
      isLiveSessionReattach: false,
      profileId: resolveNodeProfileId(options.node),
      runtimeKind: resolveNodeRuntimeKind(options.node),
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: remoteUnavailable ? null : formatRecoverableError('Terminal launch failed', error),
      recoveryIssue: remoteUnavailable ? 'remote_worker_unavailable' : null,
      scrollback,
      terminalGeometry: options.node.terminalGeometry,
      workerBinding: launchContext.workerBinding,
      executionDirectory: normalizeOptionalString(options.node.executionDirectory),
      expectedDirectory: normalizeOptionalString(options.node.expectedDirectory),
      agent: null,
    })
  }
}
