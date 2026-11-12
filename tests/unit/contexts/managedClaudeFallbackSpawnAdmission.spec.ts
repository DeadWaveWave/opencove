import { it } from 'vitest'
import { checkLegacyPreparationInterleaving } from '../../support/managedClaudePreparationInterleaving'

it.each(['plain', 'mount'] as const)(
  'rejects legacy %s fallback after activity preparation yields to adoption B',
  route =>
    checkLegacyPreparationInterleaving({
      route,
      adoption: true,
      client: 'Desktop',
      phase: 'fallback',
    }),
)
