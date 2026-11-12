import { stripParentAgentSessionEnv } from '../../shared/runtime/stripParentAgentSessionEnv'

/** Run synchronously at the Worker entry, before any startup work or shell hydration. */
export function configureWorkerEnvironment(): void {
  stripParentAgentSessionEnv(process.env)
}
