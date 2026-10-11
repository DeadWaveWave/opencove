import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { enqueueSessionOperation } from './ptyStreamHub.operationQueue'
import type { SessionState } from './ptyStreamState'

/** Programmatic input shares the PTY mutation queue without stealing UI geometry authority. */
export async function writeAutomationInput(options: {
  sessions: Map<string, SessionState>
  runtime: ControlSurfacePtyRuntime
  sessionId: string
  data: string
  assertActive: () => void
  validateBinding: () => Promise<void>
}) {
  const session = options.sessions.get(options.sessionId)
  if (!session) {
    throw new Error('Terminal session is unavailable.')
  }
  await enqueueSessionOperation(session, async () => {
    await options.runtime.waitForShellReady?.(options.sessionId)
    await options.validateBinding()
    options.assertActive()
    if (options.sessions.get(options.sessionId) !== session || session.status !== 'running') {
      throw new Error('Terminal session is no longer running.')
    }
    options.runtime.write(options.sessionId, options.data)
  })
}

export function currentAgentState(session: SessionState | undefined) {
  return session
    ? ([...session.agentStateBySource.values()].sort(
        (a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0),
      )[0] ?? null)
    : null
}
