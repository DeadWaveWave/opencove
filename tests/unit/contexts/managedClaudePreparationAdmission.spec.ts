import { it } from 'vitest'
import { checkLegacyPreparationInterleaving } from '../../support/managedClaudePreparationInterleaving'

it.each(['mount', 'fallback'] as const)(
  'rejects ownership acquired during legacy %s preparation',
  phase => checkLegacyPreparationInterleaving({ adoption: true, client: 'Desktop', phase }),
)

it.each(['mount', 'fallback'] as const)('rejects a superseded capable %s preparation', phase =>
  checkLegacyPreparationInterleaving({ adoption: true, client: 'Desktop', phase, capable: true }),
)
