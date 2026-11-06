import { normalizeTerminalAgentActivityList } from '../sessionActivityNormalize'
import { normalizeLaunchAgentInMountPayload } from '../sessionMountNormalize'
import { normalizeWorkspaceIdPayload } from '../sessionPrepareNormalize'
import { normalizeStopNode, normalizeWriteNode } from '../sessionNodeInputNormalize'
import { normalizeAttachPayload, normalizeDetachPayload } from '../sessionWatcherNormalize'
import {
  normalizeSnapshotPayload,
  normalizePresentationSnapshotPayload,
  normalizeSpawnTerminalPayload,
} from '../sessionStreamingNormalize'
import { normalizeSessionFinalMessage } from '../sessionFinalMessageHandlerNormalize'
import { normalizeSessionGet, normalizeSessionKill } from '../sessionHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
import * as z from 'zod'
import { normalizeLaunchAgentPayload } from '../sessionNormalize'
export const sessionAttachAgentStateWatcherOperation = defineOperation({
  input: z.looseObject({
    sessionId: z.string().describe('Terminal or agent session identifier'),
    provider: z.string().describe('Agent provider id'),
    cwd: z.string().describe('Approved working directory'),
    launchMode: z
      .string()
      .describe('Start a new conversation (new) or continue an earlier one (resume)'),
    startedAtMs: z.number().describe('Positive launch time in milliseconds'),
    resumeSessionId: z.unknown().optional().describe('Resume id; non-strings become null'),
  }),
  normalize: normalizeAttachPayload,
  legacyNormalize: normalizeAttachPayload,
  errors: ['session.not_found'],
  id: 'session.attachAgentStateWatcher',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Start agent state observation for an existing session when enabled',
})
export const sessionDetachAgentStateWatcherOperation = defineOperation({
  input: z.looseObject({ sessionId: z.string().describe('Terminal or agent session identifier') }),
  normalize: normalizeDetachPayload,
  legacyNormalize: normalizeDetachPayload,
  errors: [],
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
export const sessionLaunchAgentInMountOperation = defineOperation({
  input: z.looseObject({
    mountId: z.string().describe('Project mount to run the agent in'),
    cwdUri: z.string().nullish().describe('File URI within the mount'),
    prompt: z.string().describe('Agent prompt'),
    agentFullAccess: z
      .boolean()
      .nullish()
      .describe('Override the full-access setting for this launch'),
    model: z.string().nullish().describe('Provider model to use; omit for the configured default'),
    mode: z
      .string()
      .nullish()
      .describe('resume continues resumeSessionId; any other value starts a new conversation'),
    resumeSessionId: z
      .string()
      .nullish()
      .describe('Provider conversation to continue when mode is resume'),
    provider: z
      .unknown()
      .optional()
      .describe('Agent provider id; blank or non-string values use configured provider'),
    env: z
      .unknown()
      .optional()
      .describe(
        'Environment overrides; shared environment normalizer filters invalid keys and values',
      ),
    executablePathOverride: z
      .unknown()
      .optional()
      .describe('Agent executable override; blank or non-string values are ignored'),
    cols: z
      .unknown()
      .optional()
      .describe('Positive column count, rounded down; invalid values use the operation default'),
    rows: z
      .unknown()
      .optional()
      .describe('Positive row count, rounded down; invalid values use the operation default'),
  }),
  normalize: normalizeLaunchAgentInMountPayload,
  legacyNormalize: normalizeLaunchAgentInMountPayload,
  errors: ['worker.unavailable', 'agent.launch_failed', 'terminal.runtime_not_ready'],
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
export const sessionPrepareOrReviveOperation = defineOperation({
  input: z.looseObject({
    workspaceId: z.string().describe('Project whose nodes are prepared'),
    nodeIds: z
      .array(z.unknown())
      .nullish()
      .describe('Node ids to revive; non-string entries are ignored'),
  }),
  normalize: normalizeWorkspaceIdPayload,
  legacyNormalize: normalizeWorkspaceIdPayload,
  errors: ['terminal.runtime_not_ready', 'persistence.unavailable'],
  id: 'session.prepareOrRevive',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Reattach or revive persisted terminal and agent nodes in a workspace',
})
export const sessionPresentationSnapshotOperation = defineOperation({
  input: z.looseObject({ sessionId: z.string().describe('Terminal or agent session identifier') }),
  normalize: normalizePresentationSnapshotPayload,
  legacyNormalize: normalizePresentationSnapshotPayload,
  errors: ['session.not_found'],
  id: 'session.presentationSnapshot',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get canonical terminal screen state and geometry for a session',
})
export const sessionSnapshotOperation = defineOperation({
  input: z.looseObject({ sessionId: z.string().describe('Terminal or agent session identifier') }),
  normalize: normalizeSnapshotPayload,
  legacyNormalize: normalizeSnapshotPayload,
  errors: ['session.not_found'],
  id: 'session.snapshot',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get buffered terminal output and stream position for a session',
})
export const sessionSpawnTerminalOperation = defineOperation({
  input: z.looseObject({
    spaceId: z.string().describe('Space to start the terminal in'),
    runtime: z
      .unknown()
      .optional()
      .describe('Use shell or node; other values select the default runtime'),
    command: z
      .unknown()
      .optional()
      .describe('Command to launch; blank or non-string values use the default shell'),
    args: z
      .unknown()
      .optional()
      .describe('Command argument strings; non-string arrays and non-arrays are ignored'),
    cols: z
      .unknown()
      .optional()
      .describe('Positive column count, rounded down; invalid values use the operation default'),
    rows: z
      .unknown()
      .optional()
      .describe('Positive row count, rounded down; invalid values use the operation default'),
  }),
  normalize: normalizeSpawnTerminalPayload,
  legacyNormalize: normalizeSpawnTerminalPayload,
  errors: [
    'space.not_found',
    'persistence.unavailable',
    'terminal.spawn_failed',
    'terminal.runtime_not_ready',
    'worker.unavailable',
  ],
  id: 'session.spawnTerminal',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Start a terminal process in a space using its mount and profile settings',
})
export const sessionStopNodeOperation = defineOperation({
  input: z.union([
    z.looseObject({
      nodeId: z.string().describe('Canvas node that owns the session'),
      sessionId: z.string().describe('Terminal or agent session identifier'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeStopNode,
  legacyNormalize: normalizeStopNode,
  errors: ['session.not_found', 'terminal.kill_failed'],
  id: 'session.stopNode',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Kill a node process only if its session binding still matches',
})
export const sessionTerminalAgentActivityListOperation = defineOperation({
  input: z
    .strictObject({})
    .nullish()
    .describe(
      'Omit the payload or send null; object payloads are rejected for legacy compatibility',
    ),
  normalize: normalizeTerminalAgentActivityList,
  legacyNormalize: normalizeTerminalAgentActivityList,
  errors: [],
  id: 'session.terminalAgentActivity.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List observed agent activity metadata for terminal sessions',
})
export const sessionWriteNodeOperation = defineOperation({
  input: z.looseObject({
    nodeId: z.string().describe('Canvas node that owns the session'),
    sessionId: z.string().describe('Terminal or agent session identifier'),
    data: z.string().describe('Terminal input, at most 32 KiB'),
  }),
  normalize: normalizeWriteNode,
  legacyNormalize: normalizeWriteNode,
  errors: ['session.not_found'],
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
