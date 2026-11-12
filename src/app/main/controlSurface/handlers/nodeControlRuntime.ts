import { physicalSpawnLifecycle } from '../../../../shared/runtime/physicalSpawnLifecycle'
import type {
  AgentSpawnAdmissionOwner,
  AgentSpawnPermit,
} from '../../../../contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import { ABSENT_MANAGED_CLAUDE_BINDING } from '../../../../shared/contracts/managedClaudeLaunch'
import process from 'node:process'
import { basename } from 'node:path'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type {
  SpawnTerminalInMountInput,
  SpawnTerminalInput,
  SpawnTerminalResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import type { NodeControlRuntimeDeps } from '../../../../contexts/workspace/application/nodeControl/nodeControlUseCases'
import {
  managedAgentProvider,
  managedTerminalRuntimeKind,
} from './nodeControlHandlerRuntimeMetadata'
import { nodeWorkerBindingForMount } from '../../../../shared/types/nodeWorkerBinding'
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null
}
function requiredString(value: unknown, name: string): string {
  const result = optionalString(value)
  if (!result) {
    throw new Error(`Missing ${name}.`)
  }
  return result
}
async function invokeInternal<TResult>(
  controlSurface: ControlSurface,
  ctx: ControlSurfaceContext,
  request: { kind: 'query' | 'command'; id: string; payload: unknown },
): Promise<TResult> {
  const result = await controlSurface.invoke(ctx, request)
  if (!result.ok) {
    throw createAppError(result.error)
  }
  return result.value as TResult
}

function resolveTerminalCommand(data: { shell: string | null; command: string | null }): {
  shell: string | null
  command: string | null
  args: string[] | null
} {
  if (!data.command) {
    return { shell: data.shell, command: null, args: null }
  }
  const shell = data.shell ?? resolveDefaultShell()
  if (process.platform === 'win32' || data.shell) {
    const name = basename(shell).toLowerCase()
    if (name.includes('cmd')) {
      return { shell: null, command: shell, args: ['/d', '/s', '/c', data.command] }
    }
    if (name.includes('powershell') || name.includes('pwsh')) {
      return { shell: null, command: shell, args: ['-NoLogo', '-Command', data.command] }
    }

    return { shell: null, command: shell, args: ['-lc', data.command] }
  }
  return { shell: null, command: shell, args: ['-lc', data.command] }
}

export function createRuntimeDeps(
  controlSurface: ControlSurface,
  ctx: ControlSurfaceContext,
  closeWebsiteNode: ((nodeId: string) => Promise<void> | void) | undefined,
  closePluginNode?: (nodeId: string) => Promise<void> | void,
  admission?: AgentSpawnAdmissionOwner,
  killExactSession?: (sessionId: string) => void | Promise<void>,
): NodeControlRuntimeDeps {
  let permit: AgentSpawnPermit | undefined
  const killSession = async (sessionId: string): Promise<void> => {
    if (killExactSession) {
      await killExactSession(sessionId)
      return
    }
    await invokeInternal<void>(
      controlSurface,
      { ...ctx, assertActive: undefined },
      {
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId },
      },
    )
  }
  return {
    withSpawnPermit: async (value, execute) => {
      permit = value
      return physicalSpawnLifecycle.run(
        {
          singleAttempt: true,
          beginSpawn: () => admission!.consume(value),
          beforeDispatch: execution => {
            ctx.assertActive?.()
            if (execution) {
              admission!.assertExecution(value, execution)
            }
          },
          started: () => {},
          completed: () => {},
          unknown: () => {},
        },
        execute,
      )
    },
    cleanupUncommittedSpawn: async nodeId => {
      await Promise.allSettled(
        (admission?.sessionsForNode(nodeId) ?? []).map(sessionId =>
          Promise.resolve().then(() => killSession(sessionId)),
        ),
      )
    },
    assertActive: ctx.assertActive,
    validateTarget: async target => {
      if (permit) {
        admission!.assertTarget(permit, target)
      }
      await ctx.validateNodeTarget?.(target)
    },
    launchAgent: async (resolved, data) => {
      const spawnContext = {
        ...ctx,
        clientFeatures: { managedClaudeResumeBindingV1: true as const },
        agentSpawnPermit: permit,
        managedClaudeIntent: {
          kind: 'launchNew' as const,
          expected: ABSENT_MANAGED_CLAUDE_BINDING,
        },
        spawnIdentity: resolved.canvasNodeId
          ? {
              projectId: resolved.workspace.id,
              spaceId: resolved.space?.id ?? '',
              nodeId: resolved.canvasNodeId,
            }
          : undefined,
      }
      const payload = resolved.mount
        ? {
            mountId: resolved.mount.mountId,
            cwdUri: toFileUri(resolved.workingDirectory),
            prompt: data.prompt,
            provider: data.provider,
            model: data.model,
            ...(data.agentFullAccess === undefined
              ? {}
              : { agentFullAccess: data.agentFullAccess }),
          }
        : {
            spaceId: resolved.space?.id,
            prompt: data.prompt,
            provider: data.provider,
            model: data.model,
            ...(data.agentFullAccess === undefined
              ? {}
              : { agentFullAccess: data.agentFullAccess }),
          }
      ctx.assertActive?.()
      const launched = await invokeInternal<Record<string, unknown>>(controlSurface, spawnContext, {
        kind: 'command',
        id: resolved.mount ? 'session.launchAgentInMount' : 'session.launchAgent',
        payload,
      })
      const executionContext = isRecord(launched.executionContext) ? launched.executionContext : {}
      return {
        sessionId: requiredString(launched.sessionId, 'sessionId'),
        provider: managedAgentProvider(launched.provider),
        prompt: data.prompt,
        model: data.model,
        effectiveModel: optionalString(launched.effectiveModel),
        resumeSessionId: optionalString(launched.resumeSessionId),
        executionDirectory:
          optionalString(executionContext.workingDirectory) ?? resolved.workingDirectory,
        expectedDirectory: resolved.workingDirectory,
        startedAt: optionalString(launched.startedAt) ?? ctx.now().toISOString(),
        profileId: launched.profileId === null ? null : optionalString(launched.profileId),
        runtimeKind: managedTerminalRuntimeKind(launched.runtimeKind),
        workerBinding: nodeWorkerBindingForMount(resolved.mount),
      }
    },
    spawnTerminal: async (resolved, data) => {
      const spawnContext = {
        ...ctx,
        agentSpawnPermit: permit,
        spawnIdentity: resolved.canvasNodeId
          ? {
              projectId: resolved.workspace.id,
              spaceId: resolved.space?.id ?? '',
              nodeId: resolved.canvasNodeId,
            }
          : undefined,
      }
      if (resolved.endpoint.kind === 'remote_worker' && data.command && !data.shell) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'A remote terminal command requires an explicit target shell.',
        })
      }
      const terminalCommand = resolveTerminalCommand(data)
      const base = {
        profileId: data.profileId ?? undefined,
        shell: terminalCommand.shell ?? undefined,
        command: terminalCommand.command ?? undefined,
        args: terminalCommand.args ?? undefined,
        cols: 80,
        rows: 24,
      }
      ctx.assertActive?.()
      const result = resolved.mount
        ? await invokeInternal<SpawnTerminalResult>(controlSurface, spawnContext, {
            kind: 'command',
            id: 'pty.spawnInMount',
            payload: {
              mountId: resolved.mount.mountId,
              cwdUri: toFileUri(resolved.workingDirectory),
              ...base,
            } satisfies SpawnTerminalInMountInput,
          })
        : await invokeInternal<SpawnTerminalResult>(controlSurface, spawnContext, {
            kind: 'command',
            id: 'pty.spawn',
            payload: {
              cwd: resolved.workingDirectory,
              workspaceId: resolved.workspace.id,
              ...base,
            } satisfies SpawnTerminalInput,
          })
      return {
        sessionId: result.sessionId,
        executionDirectory: resolved.workingDirectory,
        expectedDirectory: resolved.workingDirectory,
        startedAt: ctx.now().toISOString(),
        profileId: result.profileId ?? data.profileId,
        runtimeKind: result.runtimeKind ?? null,
        workerBinding: nodeWorkerBindingForMount(resolved.mount),
      }
    },
    killSession,
    closeWebsiteNode,
    closePluginNode,
  }
}
