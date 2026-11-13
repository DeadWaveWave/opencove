import { execFileSync } from 'node:child_process'

type Run = (command: string, args: string[]) => string
const execute: Run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, WSL_UTF8: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Probe only infrastructure; receiver execution and its assertions must never be caught here. */
export function findWslGuest(
  requested = process.env.OPENCOVE_TEST_WSL_DISTRO,
  run: Run = execute,
): { distro: string; skipReason?: never } | { distro?: never; skipReason: string } {
  let distros: string[]
  try {
    distros = run('wsl.exe', ['--list', '--quiet'])
      .replaceAll('\0', '')
      .split(/\r?\n/u)
      .map(value => value.trim())
      .filter(Boolean)
  } catch {
    return { skipReason: 'WSL is not installed or cannot list distributions on this runner.' }
  }
  const distro = requested || distros[0]
  if (!distro || !distros.includes(distro)) {
    return {
      skipReason: requested
        ? `WSL distribution ${requested} is not installed on this runner.`
        : 'No WSL distribution is installed on this runner.',
    }
  }
  try {
    run('wsl.exe', ['--distribution', distro, '--exec', '/bin/true'])
  } catch {
    return { skipReason: `WSL distribution ${distro} cannot start on this runner.` }
  }
  return { distro }
}
