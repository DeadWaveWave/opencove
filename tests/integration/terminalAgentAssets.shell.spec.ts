import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentActivityGateway } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentActivityEnvironmentService } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

function killShellGroup(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error
    }
  }
}

function observe(child: ChildProcessWithoutNullStreams) {
  let output = ''
  child.stdout.on('data', chunk => {
    output += String(chunk)
  })
  child.stderr.on('data', chunk => {
    output += String(chunk)
  })
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  // Attach an error consumer immediately; assertions and cleanup still await the original promise.
  void done.catch(() => undefined)
  return { child, done, output: () => output }
}

describe.skipIf(process.platform === 'win32')('live shell asset recovery', () => {
  it.each(['/bin/bash', '/bin/zsh'].filter(existsSync))(
    'restores the original shim PATH of an already running %s',
    async shell => {
      const root = await mkdtemp(join(tmpdir(), 'opencove-assets-shell-'))
      const home = join(root, 'home')
      const bin = join(root, 'provider bin')
      await mkdir(home)
      await mkdir(bin)
      await writeFile(join(bin, 'pi'), '#!/bin/sh\nprintf "FAKE_PI_%s\\n" "$1"\n')
      await chmod(join(bin, 'pi'), 0o700)
      const store = new TerminalAgentTelemetryAssetStore({
        parentDirectory: root,
        platform: process.platform,
        runtimeExecutable: process.execPath,
      })
      const gateway = new TerminalAgentActivityGateway({
        registry: new TerminalAgentInvocationRegistry(),
        resolveHookInjection: () => null,
      })
      const service = new TerminalAgentActivityEnvironmentService({
        assets: store,
        gateway,
        inheritedPath: '/usr/bin:/bin',
        inheritedShell: shell,
        platform: process.platform,
      })
      const command = {
        command: shell,
        // Exercise the real interactive startup and PATH without readline's pipe input handling.
        args: ['-c', 'printf "SHELL_READY\\n"; while IFS= read -r line; do eval "$line"; done'],
        cwd: home,
        interactiveShell: true,
        environment: { ...process.env, HOME: home, ZDOTDIR: home, PATH: `${bin}:/usr/bin:/bin` },
      }
      const processes: ReturnType<typeof observe>[] = []
      try {
        const prepared = await service.prepare(command)
        const assets = await store.ensure()
        prepared.commit('old-shell')
        const old = observe(
          spawn(prepared.command, prepared.args, {
            env: prepared.environment,
            cwd: home,
            timeout: 15_000,
            detached: true,
          }),
        )
        processes.push(old)
        await expect.poll(old.output, { timeout: 5_000 }).toContain('SHELL_READY')
        old.child.stdin.write('pi before\n')
        await expect.poll(old.output, { timeout: 5_000 }).toContain('FAKE_PI_before')
        const verifyRecovery = async (mode: 'partial' | 'complete') => {
          if (mode === 'partial') {
            await rm(assets.launcherPath)
          } else {
            await rm(assets.rootDirectory, { recursive: true })
          }
          const next = await service.prepare(command)
          expect(next.command).toBe(prepared.command)
          const fresh = observe(
            spawn(next.command, next.args, {
              env: next.environment,
              cwd: home,
              timeout: 10_000,
              detached: true,
            }),
          )
          processes.push(fresh)
          fresh.child.stdin.end(`printf 'NEW_%s\\n' '${mode}'; exit\n`)
          expect(await fresh.done).toBe(0)
          expect(fresh.output()).toContain(`NEW_${mode}`)
          old.child.stdin.write(`pi ${mode}\n`)
          await expect.poll(old.output, { timeout: 5_000 }).toContain(`FAKE_PI_${mode}`)
          await next.dispose()
        }
        await verifyRecovery('partial')
        await verifyRecovery('complete')
        old.child.stdin.end('exit\n')
        expect(await old.done).toBe(0)
        await prepared.dispose()
      } finally {
        processes.forEach(({ child }) => killShellGroup(child))
        await Promise.allSettled(processes.map(process => process.done))
        await gateway.dispose()
        await store.dispose()
        await rm(root, { recursive: true, force: true })
      }
    },
    20_000,
  )
})
