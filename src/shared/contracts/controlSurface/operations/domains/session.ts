import { defineLegacyOperation, defineOperation } from '../defineOperation'
import * as z from 'zod'
export const sessionAttachAgentStateWatcherOperation = defineLegacyOperation({
  id: 'session.attachAgentStateWatcher',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session attach Agent State Watcher.',
})
export const sessionDetachAgentStateWatcherOperation = defineLegacyOperation({
  id: 'session.detachAgentStateWatcher',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session detach Agent State Watcher.',
})
export const sessionFinalMessageOperation = defineLegacyOperation({
  id: 'session.finalMessage',
  kind: 'query',
  // Discovery writes resumeSessionId back into the live session record.
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session final Message.',
})
export const sessionGetOperation = defineLegacyOperation({
  id: 'session.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query session get.',
})
export const sessionKillOperation = defineLegacyOperation({
  id: 'session.kill',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session kill.',
})
import { normalizeLaunchAgentPayload } from '../sessionNormalize'
export const sessionLaunchAgentOperation = defineOperation({
  id: 'session.launchAgent',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Launch an agent session.',
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
  summary: 'Perform session launch Agent In Mount.',
})
export const sessionListOperation = defineLegacyOperation({
  id: 'session.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query session list.',
})
export const sessionPrepareOrReviveOperation = defineLegacyOperation({
  id: 'session.prepareOrRevive',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session prepare Or Revive.',
})
export const sessionPresentationSnapshotOperation = defineLegacyOperation({
  id: 'session.presentationSnapshot',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform session presentation Snapshot.',
})
export const sessionSnapshotOperation = defineLegacyOperation({
  id: 'session.snapshot',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform session snapshot.',
})
export const sessionSpawnTerminalOperation = defineLegacyOperation({
  id: 'session.spawnTerminal',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session spawn Terminal.',
})
export const sessionStopNodeOperation = defineLegacyOperation({
  id: 'session.stopNode',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session stop Node.',
})
export const sessionTerminalAgentActivityListOperation = defineLegacyOperation({
  id: 'session.terminalAgentActivity.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query session terminal Agent Activity list.',
})
export const sessionWriteNodeOperation = defineLegacyOperation({
  id: 'session.writeNode',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform session write Node.',
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
