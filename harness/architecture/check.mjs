#!/usr/bin/env node
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
  updateRatchetBaseline,
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
  process.exitCode = await updateRatchetBaseline({
    report,
    config,
    acceptRises: options.acceptRises,
  })
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
