import { printUsage } from './usage.mjs'

function exitWithUsage(message) {
  process.stderr.write(message)
  printUsage()
  process.exit(2)
}

export function readFlagValue(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) {
    return null
  }

  const next = args[index + 1]
  if (!next || next.startsWith('-')) {
    return null
  }

  return next.trim() || null
}

export function requireFlagValue(args, flag) {
  const value = readFlagValue(args, flag)
  if (!value) {
    exitWithUsage(`[opencove] missing required flag: ${flag} <value>\n`)
  }

  return value
}

export function stripGlobalOptions(argv) {
  const args = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pretty' || arg === '--help' || arg === '-h') {
      continue
    }

    if (arg === '--timeout') {
      index += 1
      continue
    }

    if (arg === '--endpoint' || arg === '--token') {
      index += 1
      continue
    }

    args.push(arg)
  }

  return args
}

export function resolveTimeoutMs(argv) {
  let timeoutRaw = null
  let sawTimeoutFlag = false

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--timeout') {
      continue
    }

    sawTimeoutFlag = true
    timeoutRaw = argv[index + 1] ?? null
  }

  if (!sawTimeoutFlag) {
    return null
  }

  if (!timeoutRaw || timeoutRaw.trim().length === 0 || timeoutRaw.startsWith('-')) {
    exitWithUsage('[opencove] missing required flag: --timeout <ms>\n')
  }

  const timeoutMs = Number(timeoutRaw)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    exitWithUsage(`[opencove] invalid timeout: ${timeoutRaw}\n`)
  }

  return timeoutMs
}
