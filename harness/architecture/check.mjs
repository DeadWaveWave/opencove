#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import {
  formatArchitectureReport,
  loadArchitectureConfig,
  runArchitectureAudit,
} from './lib/architecture-rules.mjs'
import { parseCheckArgs } from './lib/cli-args.mjs'
import {
  defaultRatchetBaselinePath,
  evaluateRatchet,
  loadRatchetBaseline,
  planRatchetUpdate,
} from './lib/ratchet-baseline.mjs'

let options
try {
  options = parseCheckArgs(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`[architecture-check] ${error.message}\n`)
  process.exit(2)
}
const { mode, format, updateRatchet } = options
const ratchetPath = defaultRatchetBaselinePath

const config = await loadArchitectureConfig(options.config)
const report = await runArchitectureAudit({ config })

if (updateRatchet) {
  const plan = planRatchetUpdate({
    report,
    config,
    baseline: await loadRatchetBaseline(ratchetPath),
  })
  if (!plan.ok) {
    for (const { rule, before, after } of plan.refusals) {
      process.stderr.write(
        `[architecture-ratchet] ${rule}: total would rise from ${before} to ${after}.\n`,
      )
    }
    process.stderr.write(
      'Refusing to grow the baseline. Fix the new violations, or add a reasoned exception to harness/architecture/rules.json.\n',
    )
    process.exitCode = 1
  } else {
    await writeFile(ratchetPath, plan.serialized, 'utf8')
    process.stdout.write(`Architecture ratchet written to ${ratchetPath}.\n`)
  }
} else if (mode === 'check') {
  const result = evaluateRatchet({
    report,
    config,
    baseline: await loadRatchetBaseline(ratchetPath),
  })
  if (result.ok) {
    process.stdout.write(
      `Architecture check passed: 0 errors, ${report.summary.warnings} warning(s) frozen by the ratchet baseline.\n`,
    )
  } else {
    process.stderr.write(result.output)
    process.exitCode = 1
  }
} else if (format === 'json') {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else if (format === 'jsonl') {
  process.stdout.write(
    `${report.violations.map(violation => JSON.stringify(violation)).join('\n')}\n`,
  )
} else {
  process.stdout.write(formatArchitectureReport(report))
}
