import { fileURLToPath } from 'node:url'
import { readBaselineParts } from '../../../../scripts/lib/e2e-report.mjs'

// Use the reviewed real case inventory and per-OS samples as the regression fixture.
// Baseline refreshes must preserve balance without maintaining a second timing snapshot.
export function shardBaselineFixture(os: string) {
  const directory = fileURLToPath(new URL('../../../e2e/budget', import.meta.url))
  return {
    ids: Object.keys(readBaselineParts(directory, 'cases')),
    baseline: readBaselineParts(directory, `duration-${os}`),
  }
}
