import { isPathInsideOrEqual } from '@contexts/space/application/spaceBoundaryPolicy'

export type ControlSurfaceInvoke = <TResult>(request: {
  kind: 'query' | 'command'
  id: string
  payload: unknown
}) => Promise<TResult>

export function resolveControlSurfaceInvoke(): ControlSurfaceInvoke | null {
  const invoke = (window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } })
    .opencoveApi?.controlSurface?.invoke

  return typeof invoke === 'function' ? (invoke as ControlSurfaceInvoke) : null
}

export function shouldUseControlSurfacePlainRuntime(options: {
  workspacePath: string
  executionDirectory: string
}): boolean {
  const workspacePath = options.workspacePath.trim()
  const executionDirectory = options.executionDirectory.trim()
  if (!workspacePath || !executionDirectory) {
    return false
  }

  return !isPathInsideOrEqual(workspacePath, executionDirectory)
}
