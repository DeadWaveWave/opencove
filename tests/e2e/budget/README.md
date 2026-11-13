# Electron E2E budgets

`pnpm e2e:budget` enumerates every declaration with Playwright `--list --reporter=json`.
It does not launch Electron. `cases-*.json` owns the accepted count and IDs, including
skipped and platform-specific cases. Use `test.skip` for platform gating, never conditional
declaration. IDs use the owning spec file and full title path, including parameters;
source line numbers, helper locations, project names and machine paths are excluded.

Prefer regression coverage at the lowest layer that reproduces the invariant, plus an
existing real boundary journey. To approve a new boundary case or rename:

```sh
pnpm e2e:budget:update --reason "native: verifies clipboard delivery into the real Desktop terminal"
```

Reasons must be one line, beginning with `Desktop:`, `browser:` or `native:` and describing
the boundary and unique assertion. A batch update assigns that reason to every added ID;
update separate changes separately when the reasons differ. Existing reasons are retained.
For removals only, omit `--reason`. The check rejects stale removals as well as additions,
so an old entry cannot silently be reused. Same-file removed/added titles are shown together
as possible renames; that is a review hint, not a claim of assertion equivalence.

The four stable SHA-256 partitions keep generated JSON within the repository line limit.
Do not edit generated baselines by hand. Counts are per partition; their sum is the budget.
The initial 717 cases retain every existing assertion; inventory acceptance does not imply
that every legacy case belongs at the E2E layer forever.

## Duration evidence

CI retains the list reporter and writes the complete Playwright JSON report to an artifact
per Ubuntu/macOS shard, even on failure. `e2e-duration-summary` downloads all six artifacts
and writes the job summary. Run it locally with downloaded artifacts:

```sh
node scripts/report-e2e-durations.mjs artifacts/e2e-durations
```

The script expects `ubuntu-1.json` through `ubuntu-3.json` and `macos-1.json` through
`macos-3.json`. It sums all attempts for serial cost and separately reports Playwright's
wall time, including shared hooks and runner overhead. It includes skipped, failed,
timed-out, interrupted and not-started cases. Hard runner termination may prevent JSON
finalization; missing/broken reports are warnings, never zero-cost evidence or CI failures.
Growth compares only matched, passed IDs. New slow IDs are compared against the duration
baseline, so a previously untimed test may appear there. Timing does not block CI.

`duration-<OS>-*.json` stores milliseconds, median per stable ID and OS. Initial sources:

- macOS: supplied `macos-shard-budget/parsed.json`, 6,730 passed observations across 12 runs,
  593 cases, 1–12 samples per case. Passing observations from incomplete jobs are included;
  failures/skips are excluded. Run IDs are recorded in `duration-sources.json`.
- Ubuntu: [latest successful main CI used for seeding](https://github.com/DeadWaveWave/opencove/actions/runs/43247804836),
  SHA `61f86efe69ccb8afcd3b6a48d431b7ac6652043a`; 571 passed cases, one sample each.
- Historical helper locations are matched by source file and full title to the owning
  platform-compatible spec. All passed source observations matched; none were discarded.
  Log durations have only the precision printed by Playwright's list reporter.

Update duration baselines deliberately after reviewing several comparable CI runs. Download
each run's six artifacts into its own directory under `artifacts/accepted-e2e-history/`,
then generate medians using the same parser and serializer:

```sh
node --input-type=module <<'JS'
import { readdirSync } from 'node:fs'
import { readShardReports, durationBaseline } from './scripts/report-e2e-durations.mjs'
import { writeBaselineParts } from './scripts/lib/e2e-report.mjs'
const root = 'artifacts/accepted-e2e-history'
const reports = readdirSync(root).flatMap(run => {
  const result = readShardReports(`${root}/${run}`)
  if (result.warnings.length) throw new Error(result.warnings.join('\n'))
  return result.reports
})
if (!reports.length) throw new Error('No accepted reports')
for (const [os, entries] of Object.entries(durationBaseline(reports))) {
  await writeBaselineParts('tests/e2e/budget', `duration-${os}`, entries)
}
JS
```

Record the reviewed run IDs, sample counts and any exclusions in this README when updating.
`duration-sources.json` records the initial seed; do not confuse it with later evidence.
CI never updates either baseline automatically. The timing comparison remains informational.
