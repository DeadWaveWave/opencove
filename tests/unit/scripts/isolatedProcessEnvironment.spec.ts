import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { terminalEnvironment } from '../../../src/shared/runtime/terminalEnvironment.mjs'
import {
  createIsolatedProcessEnv,
  isolateProcessEnvironment,
} from '../../../scripts/lib/isolatedProcessEnvironment.mjs'

const names = Object.values(terminalEnvironment)
const inherited = Object.fromEntries(names.map(name => [name, 'host-fixture']))

describe('isolated process environment', () => {
  it('keeps terminal injection sites on the product registry when new variables are added', () => {
    const emitters = [
      'src/app/main/controlSurface/sessionGrantPtyRuntime.ts',
      'src/app/main/controlSurface/agentHook/claudeHookChannel.ts',
      'src/app/main/controlSurface/agentHook/codexHookChannel.ts',
      'src/app/main/controlSurface/agentHook/piHookChannel.ts',
      'src/app/main/controlSurface/handlers/agentLaunchEnvironment.ts',
      'src/contexts/agent/presentation/main-ipc/register.ts',
      'src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService.ts',
      'src/platform/process/ptyHost/entry.ts',
    ]
    // A new injection must use terminalEnvironment, so it enters the sanitizer automatically.
    // Read-only checks such as request.env.OPENCOVE_ENV === '1' remain valid.
    const bypasses = emitters.flatMap(file => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/\b(OPENCOVE_[A-Z_]+)\s*(?::|=(?!=))/g)].map(
        match => `${file}: ${match[1]}`,
      )
    })
    expect(bypasses).toEqual([])
  })

  it('removes every product terminal variable, including Windows case variants', () => {
    const lowerCase = Object.fromEntries(names.map(name => [name.toLowerCase(), 'host-fixture']))
    const env = createIsolatedProcessEnv({}, { ...inherited, ...lowerCase })
    expect(Object.keys(env)).toEqual([])
    expect(Object.keys(inherited)).toEqual(names)
  })

  it('preserves runner configuration and applies deliberate test connection/identity last', () => {
    const configuration = {
      PATH: '/test/bin',
      OPENCOVE_E2E_WINDOW_MODE: 'inactive',
      OPENCOVE_TEST_USE_REAL_AGENTS: '0',
      OPENCOVE_WORKER_CLIENT: '1',
      OPENCOVE_DEV_USER_DATA_DIR: '/test/dev-profile',
    }
    const overrides = Object.fromEntries(names.map(name => [name, 'child-fixture']))
    const env = createIsolatedProcessEnv(overrides, { ...inherited, ...configuration })
    expect(Object.keys(overrides).filter(name => env[name] !== overrides[name])).toEqual([])
    expect(Object.keys(configuration).filter(name => env[name] !== configuration[name])).toEqual([])
  })

  it('cleans the owned parent once so even implicit child inheritance is isolated', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { execFileSync } from 'node:child_process';
      import { isolateProcessEnvironment } from './scripts/lib/isolatedProcessEnvironment.mjs';
      isolateProcessEnvironment();
      process.stdout.write(execFileSync(process.execPath, ['-e',
        'process.stdout.write(JSON.stringify(Object.keys(process.env)))'
      ]));
    `,
      ],
      { env: { ...process.env, ...inherited }, encoding: 'utf8' },
    )
    const childNames = JSON.parse(output) as string[]
    expect(childNames.filter(name => names.includes(name))).toEqual([])
  })

  it('starts Vitest workers without the launching terminal context', () => {
    expect(Object.keys(process.env).filter(name => names.includes(name))).toEqual([])
  })

  it('mutates only the supplied parent, leaving later fixture overrides intact', () => {
    const parent = { ...inherited, OPENCOVE_E2E_RETRIES: '0' }
    isolateProcessEnvironment(parent)
    expect(Object.keys(parent)).toEqual(['OPENCOVE_E2E_RETRIES'])
    parent[terminalEnvironment.controlUrl] = 'fixture-endpoint'
    expect(Object.keys(parent)).toContain(terminalEnvironment.controlUrl)
  })
})
