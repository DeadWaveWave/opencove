import type { SessionState } from './ptyStreamState'

export function enqueueSessionOperation<TResult>(
  session: SessionState,
  operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
  session.operationQueueDepth += 1
  const result = session.operationChain.then(operation, operation)
  const settle = (): void => {
    session.operationQueueDepth = Math.max(0, session.operationQueueDepth - 1)
  }
  session.operationChain = result.then(settle, settle)
  return result
}

export function runOrEnqueueSessionOperation(session: SessionState, operation: () => void): void {
  if (session.operationQueueDepth === 0) {
    operation()
    return
  }

  void enqueueSessionOperation(session, operation)
}
