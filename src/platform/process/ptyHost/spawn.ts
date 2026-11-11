import crypto from 'node:crypto'
import { physicalSpawnLifecycle } from '../../../shared/runtime/physicalSpawnLifecycle'
import type { PtyHostProcess } from './processTypes'
import type { PtyHostExitEvidence } from './hostExitEvidence'
import { PtyHostHandshakeError } from './supervisorSupport'
import { resolvePtyHostSpawnEnv } from './spawnEnv'
import type { PtyHostSpawnOptions } from './spawnOptions'
import type { PtyHostSpawnRequest, PtyHostResponseMessage } from './protocol'

export async function spawnHostSession(
  options: PtyHostSpawnOptions,
  deps: {
    ensureReady(): Promise<void>
    process(): PtyHostProcess | null
    hostInstanceId(): string | null
    isDisposed(): boolean
    timeoutMs: number
    exitEvidence: PtyHostExitEvidence
    request(
      child: PtyHostProcess,
      request: PtyHostSpawnRequest,
      message: string,
    ): Promise<PtyHostResponseMessage>
  },
): Promise<{ sessionId: string }> {
  const env = resolvePtyHostSpawnEnv(options.env)
  const launchId = crypto.randomUUID()
  let refused = false
  let attemptedChild: PtyHostProcess | null = null
  const spawnOnce = async (): Promise<{ sessionId: string }> => {
    await deps.ensureReady()
    const child = deps.process()
    const hostInstanceId = deps.hostInstanceId()
    if (!child || !hostInstanceId) {
      throw new Error('[pty-host] missing ready process identity')
    }
    physicalSpawnLifecycle.getStore()?.beforeDispatch(options)
    attemptedChild = child
    const requestId = crypto.randomUUID()

    const request: PtyHostSpawnRequest = {
      type: 'spawn',
      hostInstanceId,
      requestId,
      launchId,
      sessionKind: options.sessionKind ?? 'shell',
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env,
      cols: options.cols,
      rows: options.rows,
    }

    const responsePromise = deps.request(
      child,
      request,
      `[pty-host] spawn timeout after ${deps.timeoutMs}ms`,
    )
    const response = await responsePromise
    if (!response.ok) {
      refused = true
      throw new Error(
        `[pty-host] spawn failed: ${response.error.name ?? 'Error'}: ${response.error.message}`,
      )
    }
    if (response.requestType !== 'spawn') {
      throw new Error('[pty-host] spawn response type mismatch')
    }
    const sessionId = response.result.sessionId
    return { sessionId }
  }
  try {
    return await spawnOnce()
  } catch (error) {
    if (!refused && attemptedChild && !deps.exitEvidence.isRetrySafe(attemptedChild)) {
      physicalSpawnLifecycle.getStore()?.unknown(deps.exitEvidence.whenCompleted(attemptedChild))
    }
    const retryIsIdentitySafe = deps.exitEvidence.isRetrySafe(attemptedChild)
    if (
      !physicalSpawnLifecycle.getStore()?.singleAttempt &&
      retryIsIdentitySafe &&
      !deps.isDisposed() &&
      !(error instanceof PtyHostHandshakeError)
    ) {
      return await spawnOnce()
    }
    throw error
  }
}
