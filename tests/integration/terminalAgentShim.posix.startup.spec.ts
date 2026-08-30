import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalAgentActivityGateway } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentInvocationRegistry } from '../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentActivityEnvironmentService } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
  )
})

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}

async function createWrappedShell(options: {
  root: string
  shell: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
}) {
  const gateway = new TerminalAgentActivityGateway({
    registry: new TerminalAgentInvocationRegistry(),
    resolveHookInjection: () => null,
  })
  const assets = new TerminalAgentTelemetryAssetStore({
    runtimeExecutable: process.execPath,
    platform: process.platform,
  })
  const service = new TerminalAgentActivityEnvironmentService({
    assets,
    gateway,
    inheritedPath: process.env.PATH ?? '',
    inheritedShell: options.shell,
    platform: process.platform,
  })
  const prepared = await service.prepare({
    args: options.args,
    command: options.shell,
    cwd: options.root,
    environment: options.env,
    interactiveShell: true,
  })
  prepared.commit('pty-startup-comparison')
  return { assets, gateway, prepared }
}

describe.skipIf(process.platform === 'win32')(
  'terminal Agent supported shell startup parity',
  () => {
    it.skipIf(!existsSync('/bin/zsh'))(
      'matches baseline zsh login and non-login startup with a custom ZDOTDIR',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'opencove-zsh-startup-parity-'))
        roots.push(root)
        const home = join(root, 'home')
        const zdot = join(root, 'custom-zdot')
        await Promise.all([mkdir(home), mkdir(zdot)])
        await writeFile(join(zdot, '.zshenv'), 'export STARTUP_ORDER=env\n')
        await writeFile(join(zdot, '.zprofile'), 'export STARTUP_ORDER="$STARTUP_ORDER,profile"\n')
        await writeFile(join(zdot, '.zshrc'), 'export STARTUP_ORDER="$STARTUP_ORDER,rc"\n')
        await writeFile(join(zdot, '.zlogin'), 'export STARTUP_ORDER="$STARTUP_ORDER,login"\n')
        const env = { ...process.env, HOME: home, ZDOTDIR: zdot }

        await Promise.all(
          [
            { baselineArgs: ['-l', '-i', '-c'], wrappedArgs: ['-l', '-c'], label: 'login' },
            { baselineArgs: ['-i', '-c'], wrappedArgs: ['-c'], label: 'nonlogin' },
          ].map(async mode => {
            const command = `printf 'MODE=${mode.label} ORDER=%s ZDOTDIR=%s\\n' "$STARTUP_ORDER" "$ZDOTDIR"`
            const baseline = await run('/bin/zsh', [...mode.baselineArgs, command], {
              cwd: root,
              env,
            })
            const wrapped = await createWrappedShell({
              root,
              shell: '/bin/zsh',
              args: [...mode.wrappedArgs, command],
              env,
            })
            const actual = await run(wrapped.prepared.command, wrapped.prepared.args, {
              cwd: root,
              env: wrapped.prepared.environment!,
            })

            expect(actual.code).toBe(baseline.code)
            expect(actual.stdout).toBe(baseline.stdout)
            await wrapped.prepared.dispose()
            await wrapped.assets.dispose()
            await wrapped.gateway.dispose()
          }),
        )
      },
    )

    it.each([
      { label: 'malformed', content: 'export STARTUP_SENTINEL=before\nif [\n' },
      { label: 'unreadable', content: 'export STARTUP_SENTINEL=should-not-load\n' },
    ])('matches baseline bash $label user-rc outcome', async ({ label, content }) => {
      const root = await mkdtemp(join(tmpdir(), `opencove-bash-${label}-`))
      roots.push(root)
      const home = join(root, 'home')
      await mkdir(home)
      const bashRc = join(home, '.bashrc')
      await writeFile(bashRc, content)
      if (label === 'unreadable') {
        await chmod(bashRc, 0o000)
      }
      const env = { ...process.env, HOME: home }
      const command = 'printf \'RESULT=%s\\n\' "${STARTUP_SENTINEL:-missing}"'
      const baseline = await run(
        '/bin/bash',
        ['--noprofile', '--rcfile', bashRc, '-i', '-c', command],
        { cwd: root, env },
      )
      const wrapped = await createWrappedShell({
        root,
        shell: '/bin/bash',
        args: ['-c', command],
        env,
      })
      const actual = await run(wrapped.prepared.command, wrapped.prepared.args, {
        cwd: root,
        env: wrapped.prepared.environment!,
      })

      expect(actual.code).toBe(baseline.code)
      expect(actual.stdout).toBe(baseline.stdout)
      await chmod(bashRc, 0o600)
      await wrapped.prepared.dispose()
      await wrapped.assets.dispose()
      await wrapped.gateway.dispose()
    })
  },
)
