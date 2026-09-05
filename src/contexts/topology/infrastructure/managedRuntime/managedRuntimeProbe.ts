import {
  parseRuntimeBuildIdentity,
  hasManagedRuntimeCapabilities,
} from '../../../../shared/contracts/runtimeBuild'
import type { ManagedRuntimeObservation } from '../../application/ports/ManagedDeploymentPort'

export interface ManagedRuntimeConnection {
  port: number
  token: string
  deploymentId: string
}

export async function invokeManagedRuntime(
  connection: ManagedRuntimeConnection,
  id: string,
  payload: unknown = null,
): Promise<Record<string, unknown> | null> {
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${connection.port}/invoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: id === 'system.capabilities' || id.endsWith('.status') ? 'query' : 'command',
        id,
        payload,
      }),
      signal: AbortSignal.timeout(2_000),
    })
  } catch {
    return null
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      '[opencove-bootstrap:credential_mismatch] The remote service rejected the stored credential; its token will not be adopted.',
    )
  }
  if (response.status !== 200) {
    throw new Error(
      `[opencove-bootstrap:runtime_start_failed] Remote service returned HTTP ${response.status}.`,
    )
  }
  const envelope = (await response.json()) as { ok?: boolean; value?: Record<string, unknown> }
  if (envelope.ok !== true || !envelope.value || typeof envelope.value !== 'object') {
    throw new Error(
      '[opencove-bootstrap:protocol_mismatch] Remote runtime does not support the required operation.',
    )
  }
  return envelope.value
}

export async function probeManagedRuntime(
  connection: ManagedRuntimeConnection,
): Promise<ManagedRuntimeObservation | null> {
  const value = await invokeManagedRuntime(connection, 'system.capabilities')
  if (!value) {
    return null
  }
  const build = parseRuntimeBuildIdentity(value.runtimeBuild)
  if (
    !build ||
    typeof value.instanceId !== 'string' ||
    value.deploymentId !== connection.deploymentId
  ) {
    throw new Error(
      '[opencove-bootstrap:runtime_legacy] Existing service cannot prove its managed deployment identity; arrange a safe stop before upgrading.',
    )
  }
  if (value.runtimeReady !== true) {
    return null
  }
  if (!hasManagedRuntimeCapabilities(value, build)) {
    throw new Error(
      '[opencove-bootstrap:protocol_mismatch] Remote transports do not match the required protocol.',
    )
  }
  const status = await invokeManagedRuntime(connection, 'worker.maintenance.status')
  if (!status || status.instanceId !== value.instanceId) {
    return null
  }
  if (!['active', 'candidate', 'maintenance', 'stopping'].includes(String(status.phase))) {
    throw new Error('[opencove-bootstrap:protocol_mismatch] Invalid runtime maintenance state.')
  }
  return {
    instanceId: value.instanceId,
    build,
    phase: status.phase as ManagedRuntimeObservation['phase'],
    activationId: typeof status.activationId === 'string' ? status.activationId : null,
  }
}
