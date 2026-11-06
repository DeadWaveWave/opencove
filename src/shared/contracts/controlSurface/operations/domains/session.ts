import { normalizeSessionFinalMessage } from '../sessionFinalMessageHandlerNormalize'
import { normalizeSessionGet, normalizeSessionKill } from '../sessionHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
import * as z from 'zod'
import { normalizeLaunchAgentPayload } from '../sessionNormalize'
export const sessionAttachAgentStateWatcherOperation = defineLegacyOperation({
  id: 'session.attachAgentStateWatcher',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Start agent state observation for an existing session when enabled',
})
export const sessionDetachAgentStateWatcherOperation = defineLegacyOperation({
  id: 'session.detachAgentStateWatcher',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Dispose the agent state watcher attached to a session',
})
export const sessionFinalMessageOperation = defineOperation({
  input: z.object({
    sessionId: z.string(),
  }),
  normalize: normalizeSessionFinalMessage,
  legacyNormalize: normalizeSessionFinalMessage,
  errors: ['session.not_found', 'worker.unavailable', 'agent.read_last_message_failed'],
  id: 'session.finalMessage',
  kind: 'query',
  // Discovery writes resumeSessionId back into the live session record.
  scope: 'interact',
  availability: 'always',
  summary: 'Read the last agent reply and cache any discovered resume session id',
})
export const sessionGetOperation = defineOperation({
  input: z.object({
    sessionId: z.string(),
  }),
  normalize: normalizeSessionGet,
  legacyNormalize: normalizeSessionGet,
  errors: ['session.not_found'],
  id: 'session.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get a launched session by its id',
})
export const sessionKillOperation = defineOperation({
  input: z.object({
    sessionId: z.string(),
  }),
  normalize: normalizeSessionKill,
  legacyNormalize: normalizeSessionKill,
  errors: ['session.not_found', 'terminal.kill_failed'],
  id: 'session.kill',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Kill the terminal or agent process for a session',
})
export const sessionLaunchAgentOperation = defineOperation({
  id: 'session.launchAgent',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Launch or resume an agent process in a space or working directory',
  input: z.object({
    spaceId: z.string().nullish(),
    cwd: z.string().nullish(),
    prompt: z.string(),
    provider: z.string().nullish(),
    model: z.string().nullish(),
    mode: z.string().nullish(),
    resumeSessionId: z.string().nullish(),
    agentFullAccess: z.boolean().nullish(),
    env: z.unknown().optional(),
    executablePathOverride: z.unknown().optional(),
    cols: z.unknown().optional(),
    rows: z.unknown().optional(),
  }),
  normalize: normalizeLaunchAgentPayload,
  errors: [
    'space.not_found',
    'persistence.unavailable',
    'agent.launch_failed',
    'terminal.runtime_not_ready',
    'worker.unavailable',
  ],
})
export const sessionLaunchAgentInMountOperation = defineLegacyOperation({
  id: 'session.launchAgentInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Launch or resume an agent process within a local or remote mount',
})
export const sessionListOperation = defineLegacyOperation({
  id: 'session.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List terminal and agent sessions tracked by the stream hub',
})
export const sessionPrepareOrReviveOperation = defineLegacyOperation({
  id: 'session.prepareOrRevive',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Reattach or revive persisted terminal and agent nodes in a workspace',
})
export const sessionPresentationSnapshotOperation = defineLegacyOperation({
  id: 'session.presentationSnapshot',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get canonical terminal screen state and geometry for a session',
})
export const sessionSnapshotOperation = defineLegacyOperation({
  id: 'session.snapshot',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get buffered terminal output and stream position for a session',
})
export const sessionSpawnTerminalOperation = defineLegacyOperation({
  id: 'session.spawnTerminal',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Start a terminal process in a space using its mount and profile settings',
})
export const sessionStopNodeOperation = defineLegacyOperation({
  id: 'session.stopNode',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Kill a node process only if its session binding still matches',
})
export const sessionTerminalAgentActivityListOperation = defineLegacyOperation({
  id: 'session.terminalAgentActivity.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List observed agent activity metadata for terminal sessions',
})
export const sessionWriteNodeOperation = defineLegacyOperation({
  id: 'session.writeNode',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Send terminal input only while the node session binding still matches',
})
export const sessionOperations = [
  sessionAttachAgentStateWatcherOperation,
  sessionDetachAgentStateWatcherOperation,
  sessionFinalMessageOperation,
  sessionGetOperation,
  sessionKillOperation,
  sessionLaunchAgentOperation,
  sessionLaunchAgentInMountOperation,
  sessionListOperation,
  sessionPrepareOrReviveOperation,
  sessionPresentationSnapshotOperation,
  sessionSnapshotOperation,
  sessionSpawnTerminalOperation,
  sessionStopNodeOperation,
  sessionTerminalAgentActivityListOperation,
  sessionWriteNodeOperation,
] as const
