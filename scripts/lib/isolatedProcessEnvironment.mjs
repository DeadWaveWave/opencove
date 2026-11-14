import { terminalEnvironment } from '../../src/shared/runtime/terminalEnvironment.mjs'

const terminalNames = new Set(Object.values(terminalEnvironment))

/** Copy the inherited environment, then apply deliberate child-process overrides. */
export function createIsolatedProcessEnv(overrides = {}, inherited = process.env) {
  const env = { ...inherited }
  isolateProcessEnvironment(env)
  return { ...env, ...overrides }
}

/** Call at the runner entry, before workers or fixtures can capture the host environment. */
export function isolateProcessEnvironment(env = process.env) {
  for (const name of Object.keys(env)) {
    // Windows environment names are case-insensitive, including when copied into plain objects.
    if (terminalNames.has(name.toUpperCase())) {
      delete env[name]
    }
  }
}
