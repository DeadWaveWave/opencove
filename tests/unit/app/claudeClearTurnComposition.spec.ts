// @vitest-environment node
import { it } from 'vitest'
import { assertClearTurnComposition } from './claudeClearTurnComposition.helpers'
it('preserves exact A/B history across delayed Start and held B4b commitment', () =>
  assertClearTurnComposition())
