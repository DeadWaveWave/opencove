import { parseRuntimeBuildIdentity, type RuntimeBuildIdentity } from '../contracts/runtimeBuild'

declare const __OPENCOVE_RUNTIME_BUILD__: unknown

/** Embedded by the build, never taken from worker launch arguments or the remote environment. */
export function getRuntimeBuildIdentity(): RuntimeBuildIdentity | null {
  return typeof __OPENCOVE_RUNTIME_BUILD__ === 'undefined'
    ? null
    : parseRuntimeBuildIdentity(__OPENCOVE_RUNTIME_BUILD__)
}
