import { parseAcceptRises } from '../../../scripts/lib/ratchet-git.mjs'

const VALUE_OPTIONS = new Set(['--mode', '--format', '--config'])
const FLAG_OPTIONS = new Set(['--update-ratchet'])
const MODES = new Set(['audit', 'check'])

// Parses the check.mjs command line. The gate (check mode and ratchet update) always uses the
// committed rules.json and ratchet.json: neither can be redirected from the command line.
export function parseCheckArgs(rawArgv) {
  const { rules: acceptRises, rest: argv } = parseAcceptRises(rawArgv)
  const options = {
    mode: 'audit',
    format: 'text',
    config: undefined,
    updateRatchet: false,
    acceptRises,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (FLAG_OPTIONS.has(arg)) {
      options.updateRatchet = true
    } else if (VALUE_OPTIONS.has(arg)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`)
      }
      options[arg.slice(2)] = value
      index += 1
    } else {
      throw new Error(`Unknown option ${arg}.`)
    }
  }
  if (!MODES.has(options.mode)) {
    throw new Error(`--mode must be "audit" or "check", got "${options.mode}".`)
  }
  if (acceptRises.length > 0 && !options.updateRatchet) {
    throw new Error('--accept-rise only applies together with --update-ratchet.')
  }
  if (options.config !== undefined && (options.mode === 'check' || options.updateRatchet)) {
    throw new Error(
      '--config is only allowed in --mode audit; check and --update-ratchet always use harness/architecture/rules.json.',
    )
  }
  return options
}
