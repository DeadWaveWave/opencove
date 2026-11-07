import { CONTROL_SURFACE_OPERATIONS } from '../../../shared/contracts/controlSurface/operations'
import { usage } from './errors'
import { editDistance } from './suggestions'

export function unknownOperation(id: string): never {
  const domain = id.split('.')[0]
  const nearest = CONTROL_SURFACE_OPERATIONS.map(op => ({
    id: op.id,
    distance: editDistance(id.toLowerCase(), op.id.toLowerCase()),
    sameDomain: op.id.startsWith(domain + '.'),
  }))
    .filter(op => op.distance <= 2 || op.sameDomain)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(op => op.id)
  usage(
    `Unknown operation: ${id}`,
    [
      nearest.length ? `Closest IDs: ${nearest.join(', ')}.` : '',
      `Run "opencove api ops --prefix ${domain}" to explore this domain.`,
    ]
      .filter(Boolean)
      .join(' '),
  )
}
