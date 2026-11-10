import type { Invoke } from './identity'
import type { ControlSurfaceCapabilitiesResult } from '../../../shared/contracts/dto'
import { CliError } from './errors'
export async function requireNodeLineage(invoke: Invoke): Promise<void> {
  const capabilities = (await invoke('system.capabilities', {})) as ControlSurfaceCapabilitiesResult
  if (capabilities.features?.nodeLineageV1 !== true) {
    throw new CliError(
      'cli.unsupported',
      5,
      'This Worker does not support parent selectors or creation lineage filters.',
      'Update the Worker, then try again.',
    )
  }
}
export const lineageFieldDescriptions = {
  spawnedBy: 'ID of the node that created this node; null for a root or unavailable lineage',
  lineageDepth:
    'A node started by the user has lineageDepth 1; each agent-created generation adds one. Null when lineage is unavailable',
  lineageStatus:
    'recorded when creation is recorded, root when no parent is recorded, unavailable when lineage cannot be read',
}
export const lineageFields = Object.keys(lineageFieldDescriptions)
export function lineageProjection(
  value:
    | import('../../../shared/contracts/dto/nodeLineage').NodeLineageProjection
    | null
    | undefined,
) {
  // Missing fields from an older Worker must remain missing.
  return Object.fromEntries(
    lineageFields
      .filter(key => value && key in value)
      .map(key => [key, value![key as keyof NonNullable<typeof value>]]),
  )
}
export const spawnedByOption = {
  type: 'string' as const,
  selector: 'node' as const,
  valueName: 'selector',
  description:
    'Filter direct children; --project filters results. Creator names use your project, or the selected Space’s project',
}
