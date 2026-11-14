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

`duration-<OS>-*.json` stores milliseconds per stable ID and OS. Any passed observation
takes precedence: use the median of passed timings, ignoring failed/skipped attempts.
An ID observed only as skipped on that OS gets an explicit `0`, even if checking the
capability took time. Failed, timed-out, interrupted and not-started observations never
establish zero; they also prevent a mixed history without passes from becoming zero.
Absent IDs remain unknown and the planner charges the OS's positive-duration median.
Each report contributes its median passed attempt duration for a repeated/retried ID.

Initial sources (retained as fallback evidence):

- macOS: supplied `macos-shard-budget/parsed.json`, 6,730 passed observations across 12 runs,
  593 cases, 1–12 samples per case. Passing observations from incomplete jobs are included;
  failures/skips are excluded. Run IDs are recorded in `duration-sources.json`.
- Ubuntu: [latest successful main CI used for seeding](https://github.com/DeadWaveWave/opencove/actions/runs/43247804836),
  SHA `61f86efe69ccb8afcd3b6a48d431b7ac6652043a`; 571 passed cases, one sample each.
- Historical helper locations are matched by source file and full title to the owning
  platform-compatible spec. All passed source observations matched; none were discarded.
  Log durations have only the precision printed by Playwright's list reporter.

### Accepted refresh evidence

The 2026-11-13 (UTC) refresh uses these two complete sets of six duration artifacts, including
the earlier run's passing observations despite its overall failed conclusion:

| Run | macOS passed / skipped / failed | Ubuntu passed / skipped / failed |
| --- | ---: | ---: |
| [43378330455](https://github.com/DeadWaveWave/opencove/actions/runs/43378330455) | 598 / 118 / 1 | 594 / 123 / 0 |
| [43441330714](https://github.com/DeadWaveWave/opencove/actions/runs/43441330714) | 603 / 118 / 0 | 597 / 124 / 0 |

- macOS: 1,201 passed observations across 603 IDs (1–2 samples per ID), plus 236 skipped
  observations establishing 118 zero entries. The failed observation of
  `workspace-canvas.filesystem-nodes.spec.ts` /
  `filesystem nodes drag from Explorer and preserve folder navigation in light`
  is excluded from timing medians; its later pass is used.
- Ubuntu: 1,191 passed observations across 597 IDs (1–2 samples per ID), plus 247 skipped
  observations establishing 124 zero entries.
- Both baselines cover all 721 current IDs. There are no retries, timed-out, interrupted
  or not-started observations in these artifacts, and no unmatched IDs or broken reports.
- The checked-in seed at `5362c7bf7484f245974ba0b0cd23891306112690` is retained for IDs
  without recent passing samples. Recent passed medians supersede seed medians; a known
  historical pass cannot be replaced by zero. Seed medians are not counted as additional
  raw samples. In this refresh every seeded ID has a recent pass, so none need fallback.
- At collection, post-merge main run `43482258821` and rebased PR runs `43482728342`,
  `43482735517`, `43482739612`, `43483819403` had no duration artifacts yet; they are excluded.
  Only complete artifact sets enter the refresh. Missing or unfinished work is never zero.

### Refresh procedure

Review recent runs with `gh run list --repo DeadWaveWave/opencove --workflow CI` and
`gh api repos/DeadWaveWave/opencove/actions/runs/<run>/artifacts --paginate`. Include main
pushes and PR revisions based on the current shard workflow when all six non-expired
artifacts exist. Download into fresh directories and flatten them to match CI's
`merge-multiple` download layout:

```sh
set -e
mkdir -p artifacts/accepted-e2e-history
for run in 43378330455 43441330714; do
  directory="artifacts/accepted-e2e-history/$run"
  mkdir "$directory" # Must be new and empty; do not mix downloads from different attempts.
  gh run download "$run" --repo DeadWaveWave/opencove \
    --pattern 'e2e-durations-*' --dir "$directory"
  for report in "$directory"/e2e-durations-*/*.json; do
    test ! -e "$directory/$(basename "$report")"
    mv "$report" "$directory/"
  done
  rmdir "$directory"/e2e-durations-*
done
```

Generate medians with the report parser and partition serializer. Use an explicit reviewed
run list so other downloads cannot enter the baseline accidentally. Keep the original seed
as a fallback for old-only cases; do not average an aggregate seed median into raw samples:

```sh
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process'
import { readShardReports, durationBaseline } from './scripts/report-e2e-durations.mjs'
import { writeBaselineParts } from './scripts/lib/e2e-report.mjs'
const root = 'artifacts/accepted-e2e-history'
const runs = ['43378330455', '43441330714']
const seedRevision = '5362c7bf7484f245974ba0b0cd23891306112690'
const reports = runs.flatMap(run => {
  const result = readShardReports(`${root}/${run}`)
  if (result.warnings.length) throw new Error(result.warnings.join('\n'))
  return result.reports
})
if (!reports.length) throw new Error('No accepted reports')
for (const [os, recent] of Object.entries(durationBaseline(reports))) {
  const entries = Object.assign({}, ...[0, 1, 2, 3].map(part => JSON.parse(execFileSync(
    'git', ['show', `${seedRevision}:tests/e2e/budget/duration-${os}-${part}.json`],
    { encoding: 'utf8' },
  )).entries))
  for (const [id, ms] of Object.entries(recent)) {
    if (ms > 0 || !(entries[id] > 0)) entries[id] = ms
  }
  await writeBaselineParts('tests/e2e/budget', `duration-${os}`, entries)
}
JS
```

Record the reviewed run IDs, sample counts and any exclusions in this README when updating.
`duration-sources.json` records the initial seed; do not confuse it with later evidence.
Run `pnpm e2e:budget` to prove the case inventory is unchanged and
`node scripts/plan-e2e-shards.mjs --check` before and after refreshing. Replay a measured
run by summing all attempt durations for its case IDs under the new whole-file assignments;
check every ID is present once and the serial total is unchanged. Replay minutes exclude
build, shared-hook and runner overhead, so they are not a step-timeout guarantee.
CI never updates either baseline automatically. The timing comparison remains informational.
