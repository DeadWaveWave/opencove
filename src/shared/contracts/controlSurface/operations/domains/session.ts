import { managedClaudeLaunchIntentSchema } from '../managedClaudeLaunchSchema'
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
import { sessionAddressSchema, normalizeSessionAddress } from '../sessionAddress'
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
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeDetachPayload,
  errors: [],
  id: 'session.detachAgentStateWatcher',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Dispose the agent state watcher attached to a session',
})
export const sessionFinalMessageOperation = defineOperation({
  id: 'session.finalMessage',
  input: sessionAddressSchema,
  normalize: normalizeSessionAddress,
  errors: [
    'common.invalid_input',
    'session.not_found',
    'worker.unavailable',
    'persistence.unavailable',
    'session.transcript_not_ready',
    'agent.read_last_message_failed',
  ],
  kind: 'query',
  // Discovery writes resumeSessionId back into the live session record.
  scope: 'interact',
  availability: 'always',
  summary: 'Read the last agent reply and cache any discovered resume session id',
})
/** Worker-to-Worker query with node transcript readiness semantics. */
export const sessionFinalMessageForNodeOperation = defineOperation({
  id: 'session.finalMessageForNode',
  input: z
    .object({
      sessionId: z.string().describe('Agent session whose transcript is read on this Worker'),
    })
    .strict(),
  normalize: normalizeSessionAddress,
  errors: sessionFinalMessageOperation.errors,
  kind: 'query',
  // Transcript discovery can cache resumeSessionId, as in session.finalMessage.
  scope: 'interact',
  availability: 'always',
  summary: 'Read the last agent reply only when its transcript is ready',
})
export const sessionGetOperation = defineOperation({
  id: 'session.get',
  input: sessionAddressSchema,
  normalize: normalizeSessionAddress,
  errors: [
    'common.invalid_input',
    'session.not_found',
    'worker.unavailable',
    'persistence.unavailable',
  ],
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get terminal or agent session metadata by session or canvas node id',
})
export const sessionKillOperation = defineOperation({
  id: 'session.kill',
  input: sessionAddressSchema,
  normalize: normalizeSessionAddress,
  errors: [
    'common.invalid_input',
    'session.not_found',
    'worker.unavailable',
    'persistence.unavailable',
    'terminal.kill_failed',
    'agent.managed_launch_rejected',
  ],
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
    intent: managedClaudeLaunchIntentSchema.optional(),
    provider: z.string().nullish(),
    model: z.string().nullish(),
    mode: z.string().nullish(),
    resumeSessionId: z.string().nullish(),
    agentFullAccess: z.boolean().nullish(),
    codexReuseRunningAppServer: z.boolean().nullish(),
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
    'agent.managed_launch_rejected',
    'agent.managed_launch_commit_failed',
    'terminal.runtime_not_ready',
    'worker.unavailable',
  ],
})
export const sessionLaunchAgentInMountOperation = defineOperation({
  input: z.looseObject({
    mountId: z.string().describe('Project mount to run the agent in'),
    cwdUri: z.string().nullish().describe('File URI within the mount'),
    prompt: z.string().describe('Agent prompt'),
    intent: managedClaudeLaunchIntentSchema.optional(),
    codexReuseRunningAppServer: z
      .boolean()
      .nullish()
      .describe('Reuse a running Codex app-server; disables hooks and prompt delivery'),
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeLaunchAgentInMountPayload,
  errors: [
    'worker.unavailable',
    'agent.launch_failed',
    'terminal.runtime_not_ready',
    'agent.managed_launch_rejected',
    'agent.managed_launch_commit_failed',
  ],
  id: 'session.launchAgentInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Launch or resume an agent process within a local or remote mount',
})
export const sessionListOperation = defineLegacyOperation({
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeWorkspaceIdPayload,
  errors: [
    'terminal.runtime_not_ready',
    'persistence.unavailable',
    'agent.managed_launch_rejected',
    'agent.managed_launch_commit_failed',
  ],
  id: 'session.prepareOrRevive',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Reattach or revive persisted terminal and agent nodes in a workspace',
})
export const sessionPresentationSnapshotOperation = defineOperation({
  input: z.looseObject({ sessionId: z.string().describe('Terminal or agent session identifier') }),
  normalize: normalizePresentationSnapshotPayload,
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
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
      agentOnly: z
        .literal(true)
        .optional()
        .describe('Stop only if this session still hosts a live agent'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeStopNode,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeStopNode,
  errors: [
    'session.not_found',
    'terminal.kill_failed',
    'persistence.unavailable',
    'agent.managed_launch_rejected',
    'agent.not_running',
    'agent.state_unknown',
    'node.unsupported_operation',
  ],
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
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeWriteNode,
  errors: ['session.not_found'],
  id: 'session.writeNode',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Send terminal input only while the node session binding still matches',
})
export const sessionCleanupUnreferencedOperation = defineOperation({
  id: 'session.cleanupUnreferenced',
  input: z.strictObject({
    sessionId: z.string().trim().min(1).describe('Session to close if it has no saved references'),
  }),
  errors: ['persistence.unavailable'],
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Close a session only when no saved node or managed binding references it',
})
export const sessionOperations = [
  sessionCleanupUnreferencedOperation,
  sessionAttachAgentStateWatcherOperation,
  sessionDetachAgentStateWatcherOperation,
  sessionFinalMessageOperation,
  sessionFinalMessageForNodeOperation,
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
