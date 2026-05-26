#!/usr/bin/env node

import {
  formatNightlyReleaseGateOutput,
  resolveNightlyReleaseGate,
} from './lib/nightly-release-gate.mjs'

function parseArgs(argv) {
  const args = new Map()
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) {
      continue
    }

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      continue
    }

    args.set(key.slice(2), value)
    index += 1
  }

  return args
}

const args = parseArgs(process.argv)
const result = resolveNightlyReleaseGate({
  eventName: args.get('event') ?? 'schedule',
  targetRef: args.get('target') ?? 'HEAD',
})

process.stdout.write(`${formatNightlyReleaseGateOutput(result)}\n`)
