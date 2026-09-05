import { resolve } from 'node:path'

const valueOptions = new Set([
  '-c',
  '--config',
  '-m',
  '--model',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-a',
  '--ask-for-approval',
  '-C',
  '--cd',
  '-i',
  '--image',
  '--add-dir',
  '--enable',
  '--disable',
  '--local-provider',
  '--remote-auth-token-env',
])
const flagOptions = new Set([
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--approve-for-me',
  '--search',
  '--no-alt-screen',
  '--oss',
  '--strict-config',
])
const subcommands = new Set([
  'agents',
  'exec',
  'e',
  'review',
  'login',
  'logout',
  'mcp',
  'plugin',
  'mcp-server',
  'app-server',
  'remote-control',
  'app',
  'completion',
  'update',
  'doctor',
  'sandbox',
  'debug',
  'apply',
  'queue',
  'archive',
  'delete',
  'migrate-rollouts',
  'unarchive',
  'fork',
  'cloud',
  'exec-server',
  'features',
  'help',
])

export function resolveCodexInvocationArguments(
  args: readonly string[],
  cwd: string,
): {
  cwd: string
  resumeSessionId: string | null
  discoverNewSession: boolean
} {
  let directory = cwd
  let resume = false
  let resumeSessionId: string | null = null
  let discoverNewSession = true
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      break
    }
    const separator = arg.indexOf('=')
    const option = separator > 0 ? arg.slice(0, separator) : arg
    if (valueOptions.has(option)) {
      const value = separator > 0 ? arg.slice(separator + 1) : args[++index]
      if (!value) {
        return { cwd: directory, resumeSessionId: null, discoverNewSession: false }
      }
      if (option === '-C' || option === '--cd') {
        directory = resolve(cwd, value)
      }
      continue
    }
    if (flagOptions.has(option)) {
      continue
    }
    if (arg === 'resume' && !resume) {
      resume = true
      discoverNewSession = false
      continue
    }
    if (arg.startsWith('-') || (!resume && subcommands.has(arg))) {
      // Pickers, --last, remote endpoints, and unknown syntax provide no exact identity.
      return { cwd: directory, resumeSessionId: null, discoverNewSession: false }
    }
    if (resume && !resumeSessionId) {
      resumeSessionId = arg.trim() || null
    } else {
      break
    } // Positional prompt; its words are not command flags.
  }
  return { cwd: directory, resumeSessionId, discoverNewSession }
}
