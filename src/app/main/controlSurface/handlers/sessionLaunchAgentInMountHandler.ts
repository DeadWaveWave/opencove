import { spawnForbiddenDetails } from '../../../../shared/errors/agentSpawnError'
import { launchRemoteAgentInMount } from './sessionRemoteAgentLaunch'
import {
  admitManagedClaudeLaunch,
  noteManagedClaudeSpawnStarted,
  noteManagedClaudeRuntimeCreated,
} from '../managedClaudeLaunchRuntime'
import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { publicTerminalSpawnError } from '../../../../shared/errors/terminalSpawnError'
import type { AgentProviderRegistry } from '../../../../contexts/agent/application/services/AgentProviderRegistry'
import { captureGeminiSessionDiscoveryCursor } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import {
  normalizeAgentSettings,
  resolveAgentExecutablePathOverride,
  resolveAgentModel,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { LaunchAgentSessionResult } from '../../../../shared/contracts/dto'
import {
  LOCAL_AGENT_SERVER_HOSTNAME,
  reserveLoopbackPort,
  resolveAgentPtySpawnState,
  resolveExecutionContextDto,
  resolveSessionLaunchSpawn,
  getPublicTerminalSpawnCommand,
} from './sessionLaunchSupport'
import { startAgentSessionStateWatcherIfEnabled } from './sessionStateWatcherStart'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { SessionRecord } from './sessionRecords'
import { registerOperation } from '../registerOperation'
import { sessionLaunchAgentInMountOperation } from '@shared/contracts/controlSurface/operations/domains/session'
import type { TerminalSpawnAdmission } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { resolveAdmittedMountAgentLaunch } from './resolveAdmittedMountAgentLaunch'
import {
  describeAgentLaunchCommand,
  describeAgentLaunchError,
  logAgentLaunchError,
  logAgentLaunchInfo,
} from '../../diagnostics/agentLaunchRuntimeDiagnostics'
import { prepareAgentLaunch } from './prepareAgentLaunch'
import { rollbackAgentLaunchArtifacts } from '../../../../contexts/agent/application/services/AgentLaunchArtifactOwner'
import {
  admitLaunchProvider,
  mergeAgentLaunchEnvironment,
  prepareAgentSessionEnvironment,
  resolveAgentLaunchCallerEnv,
} from './agentLaunchEnvironment'

export function registerSessionLaunchAgentInMountHandler(
  controlSurface: ControlSurface,
  deps: {
    userDataPath: string
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
    topology: WorkerTopologyStore
    sessions: Map<string, SessionRecord>
    terminalSpawnAdmission: TerminalSpawnAdmission
    agentProviderRegistry: AgentProviderRegistry
  },
): void {
  registerOperation(controlSurface, sessionLaunchAgentInMountOperation, {
    handle: async (ctx, payload): Promise<LaunchAgentSessionResult> => {
      const { target, cwd, mode } = await resolveAdmittedMountAgentLaunch({
        ctx,
        payload,
        topology: deps.topology,
        admission: deps.terminalSpawnAdmission,
      })

      if (ctx.requestAuth?.kind === 'session-grant' && target.endpointId !== 'local') {
        throw createAppError('common.forbidden', {
          details: spawnForbiddenDetails('remote_spawning_unsupported'),
        })
      }
      if (target.endpointId !== 'local') {
        return launchRemoteAgentInMount({ ctx, payload, target, cwd, mode, deps })
      }

      const isApproved = await deps.approvedWorkspaces.isPathApproved(cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'session.launchAgentInMount cwd is outside approved roots',
        })
      }

      const store = await deps.getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const agentSettings = normalizeAgentSettings(normalized?.settings)

      const provider = admitLaunchProvider(ctx, payload, agentSettings, mode)
      await admitManagedClaudeLaunch(provider, cwd, payload.mountId)
      ctx.assertActive?.()
      const env = resolveAgentLaunchCallerEnv(ctx, agentSettings, provider, payload.env)
      const model = payload.model ?? resolveAgentModel(agentSettings, provider)
      const executablePathOverride =
        payload.executablePathOverride ??
        resolveAgentExecutablePathOverride(agentSettings, provider)
      const agentFullAccess = payload.agentFullAccess ?? agentSettings.agentFullAccess
      const codexReuseRunningAppServer =
        payload.codexReuseRunningAppServer ?? agentSettings.codexReuseRunningAppServer
      logAgentLaunchInfo(
        'control-surface-mount-local-resolved-settings',
        'Resolved local mount agent launch settings.',
        {
          mountId: payload.mountId,
          provider,
          mode,
          cwd,
          modelPresent: !!model,
          executablePathOverridePresent: !!executablePathOverride,
          agentFullAccess,
          codexReuseRunningAppServer,
          cols: payload.cols ?? 80,
          rows: payload.rows ?? 24,
        },
      )

      const opencodeServer =
        provider === 'opencode'
          ? {
              hostname: LOCAL_AGENT_SERVER_HOSTNAME,
              port: await reserveLoopbackPort(LOCAL_AGENT_SERVER_HOSTNAME),
            }
          : null

      const sessionEnv = await prepareAgentSessionEnvironment({
        provider,
        opencodeServer,
        userDataPath: deps.userDataPath,
      })

      const resumeSessionId = mode === 'resume' ? (payload.resumeSessionId ?? null) : null
      const { launchCommand, managedLaunch, testStub } = await prepareAgentLaunch({
        environment: { ...sessionEnv, ...env },
        registry: deps.agentProviderRegistry,
        profileId: agentSettings.defaultTerminalProfileId,
        provider,
        cwd,
        mode,
        model,
        resumeSessionId,
        prompt: payload.prompt,
        agentFullAccess,
        codexReuseRunningAppServer,
        opencodeServer,
        executablePathOverride,
      })
      logAgentLaunchInfo(
        'control-surface-mount-local-command-built',
        'Built local mount agent launch command before spawn resolution.',
        describeAgentLaunchCommand({
          provider,
          mode,
          cwd,
          command: launchCommand.command,
          args: launchCommand.args,
          executablePathOverride,
        }),
      )

      const startedAtMs = Date.now()
      const startedAt = new Date(startedAtMs).toISOString()

      const mergedEnv = mergeAgentLaunchEnvironment({
        testEnvironment: testStub?.env,
        sessionEnvironment: sessionEnv,
        requestedEnvironment: env,
        providerEnvironment: managedLaunch.plan.env,
      })

      const resolvedSpawn = await resolveSessionLaunchSpawn({
        workingDirectory: cwd,
        defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
        command: launchCommand.command,
        args: launchCommand.args,
        fileArguments: launchCommand.fileArguments,
        provider: testStub ? null : provider,
        executablePathOverride,
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
      }).catch(error => {
        logAgentLaunchError(
          'control-surface-mount-local-spawn-resolve-failed',
          'Failed to resolve local mount spawn.',
          {
            mountId: payload.mountId,
            provider,
            mode,
            cwd,
            ...describeAgentLaunchError(error),
          },
        )
        return rollbackAgentLaunchArtifacts(
          publicTerminalSpawnError(error, 'agent.launch_failed'),
          managedLaunch.artifacts,
        )
      })
      logAgentLaunchInfo(
        'control-surface-mount-local-spawn-resolved',
        'Resolved local mount agent spawn command.',
        describeAgentLaunchCommand({
          provider,
          mode,
          cwd: resolvedSpawn.cwd,
          command: resolvedSpawn.command,
          args: resolvedSpawn.args,
          executablePathOverride,
          env: resolvedSpawn.env,
        }),
      )
      const publicCommand = getPublicTerminalSpawnCommand(resolvedSpawn)
      const geminiDiscoveryCursor =
        provider === 'gemini' && mode === 'new'
          ? await captureGeminiSessionDiscoveryCursor(cwd).catch(() => null)
          : undefined
      const spawnCols = payload.cols ?? 80
      const spawnRows = payload.rows ?? 24
      logAgentLaunchInfo(
        'control-surface-mount-local-pty-spawn-start',
        'Spawning local mount agent PTY session.',
        {
          mountId: payload.mountId,
          provider,
          mode,
          cwd: resolvedSpawn.cwd,
          cols: spawnCols,
          rows: spawnRows,
          command: resolvedSpawn.command,
          argCount: resolvedSpawn.args.length,
        },
      )
      try {
        ctx.assertActive?.()
      } catch (error) {
        return rollbackAgentLaunchArtifacts(error, managedLaunch.artifacts)
      }
      noteManagedClaudeSpawnStarted()
      const { sessionId } = await deps.ptyRuntime
        .spawnSession({
          cwd: resolvedSpawn.cwd,
          cols: spawnCols,
          rows: spawnRows,
          command: resolvedSpawn.command,
          args: resolvedSpawn.args,
          ...resolveAgentPtySpawnState(provider, payload.prompt, mode),
          ...(resolvedSpawn.env ? { env: resolvedSpawn.env } : {}),
          ...(managedLaunch.plan.hookInstallState
            ? { hookInstallState: managedLaunch.plan.hookInstallState }
            : {}),
          hookCoverage: managedLaunch.plan.hookCoverage,
          launchArtifacts: managedLaunch.artifacts,
        })
        .catch(error => {
          logAgentLaunchError(
            'control-surface-mount-local-pty-spawn-failed',
            'Local mount PTY spawn failed.',
            {
              mountId: payload.mountId,
              provider,
              mode,
              cwd: resolvedSpawn.cwd,
              cols: spawnCols,
              rows: spawnRows,
              command: resolvedSpawn.command,
              ...describeAgentLaunchError(error),
            },
          )
          throw publicTerminalSpawnError(error, 'agent.launch_failed')
        })
      noteManagedClaudeRuntimeCreated(sessionId)
      managedLaunch.plan.onStarted?.(sessionId)
      logAgentLaunchInfo(
        'control-surface-mount-local-pty-spawn-succeeded',
        'Local mount agent PTY session spawned.',
        {
          mountId: payload.mountId,
          provider,
          mode,
          cwd: resolvedSpawn.cwd,
          sessionId,
          cols: spawnCols,
          rows: spawnRows,
        },
      )

      startAgentSessionStateWatcherIfEnabled({
        hookInstallState: managedLaunch.plan.hookInstallState,
        ptyRuntime: deps.ptyRuntime,
        sessionId,
        provider,
        cwd,
        launchMode: mode,
        resumeSessionId: managedLaunch.plan.resumeSessionId,
        startedAtMs,
        ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
        opencodeBaseUrl: opencodeServer
          ? `http://${opencodeServer.hostname}:${String(opencodeServer.port)}`
          : null,
      })

      const executionContext = resolveExecutionContextDto(cwd, {
        projectId: null,
        spaceId: null,
        mountId: payload.mountId,
        targetId: target.targetId,
        endpointId: 'local',
        endpointKind: 'local',
        targetRootPath: target.rootPath,
        targetRootUri: target.rootUri,
        scopeRootPath: target.rootPath,
        scopeRootUri: target.rootUri,
      })

      const record: SessionRecord = {
        sessionId,
        provider,
        startedAt,
        cwd,
        prompt: payload.prompt,
        model,
        effectiveModel: launchCommand.effectiveModel,
        executionContext,
        resumeSessionId: managedLaunch.plan.resumeSessionId,
        startedAtMs,
        ...publicCommand,
        launchMode: mode,
        ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
        route: { kind: 'local' },
      }

      deps.sessions.set(sessionId, record)
      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'agent',
        startedAt,
        cwd,
        ...publicCommand,
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
      })

      return {
        sessionId,
        provider,
        startedAt,
        executionContext,
        profileId: resolvedSpawn.profileId,
        runtimeKind: resolvedSpawn.runtimeKind,
        resumeSessionId: record.resumeSessionId ?? null,
        effectiveModel: launchCommand.effectiveModel,
        ...publicCommand,
      }
    },
    defaultErrorCode: 'agent.launch_failed',
  })
}
