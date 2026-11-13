import type { Invoke } from './identity'
import type { ControlSurfaceCapabilitiesResult } from '../../../shared/contracts/dto'
import { CliError } from './errors'

/** Both dedicated commands and api call must preserve explicit placement intent. */
export async function requireNodeNearPlacement(id: string, payload: unknown, invoke: Invoke) {
  if (id !== 'node.create' || !(payload && typeof payload === 'object' && 'near' in payload)) {
    return
  }
  const result = (await invoke('system.capabilities', {})) as ControlSurfaceCapabilitiesResult
  if (result.features?.nodeNearPlacementV1 !== true) {
    throw new CliError(
      'cli.unsupported',
      5,
      'This Worker does not support --near placement.',
      'Upgrade the connected OpenCove Worker to use --near.',
    )
  }
}
