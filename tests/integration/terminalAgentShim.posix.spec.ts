import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalAgentActivityGateway } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
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
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string },
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
    if (options.input !== undefined) {
      child.stdin.end(options.input)
    }
  })
}

describe.skipIf(process.platform === 'win32')('terminal Agent POSIX shim', () => {
  it.skipIf(!existsSync('/bin/zsh'))(
    'mirrors the zsh login startup chain after a custom ZDOTDIR replaces PATH',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'opencove-terminal-shim-zsh-'))
      roots.push(root)
      const home = join(root, 'home')
      const userZdot = join(root, 'user-zdot')
      const realBin = join(root, 'real')
      await mkdir(home)
      await mkdir(userZdot)
      await mkdir(realBin)
      await writeFile(
        join(userZdot, '.zshenv'),
        `export STARTUP_ORDER=env\nexport PATH=${JSON.stringify(`${realBin}:/usr/bin:/bin`)}\n`,
      )
      await writeFile(
        join(userZdot, '.zprofile'),
        `export STARTUP_ORDER="$STARTUP_ORDER,profile"\nexport PATH=${JSON.stringify(
          `${realBin}:/usr/bin:/bin`,
        )}\n`,
      )
      await writeFile(join(userZdot, '.zshrc'), 'export STARTUP_ORDER="$STARTUP_ORDER,rc"\n')
      await writeFile(join(userZdot, '.zlogin'), 'export STARTUP_ORDER="$STARTUP_ORDER,login"\n')
      const realCodex = join(realBin, 'codex')
      await writeFile(realCodex, '#!/bin/sh\nprintf "CODEX=<%s>\\n" "$1"\nexit 29\n')
      await chmod(realCodex, 0o700)
      const gateway = new TerminalAgentActivityGateway({
        resolveHookInjection: () => ({
          prepareHookInjection: async () => ({
            args: ['--zsh-hook'],
            env: {},
            hookInstallState: 'installed',
          }),
        }),
      })
      const assets = new TerminalAgentTelemetryAssetStore({
        runtimeExecutable: process.execPath,
        platform: process.platform,
      })
      const service = new TerminalAgentActivityEnvironmentService({
        assets,
        gateway,
        inheritedPath: process.env.PATH ?? '',
        inheritedShell: '/bin/zsh',
        platform: process.platform,
      })
      const prepared = await service.prepare({
        args: ['-l', '-c', 'printf "ORDER=%s\\n" "$STARTUP_ORDER"; codex'],
        command: '/bin/zsh',
        cwd: root,
        environment: { ...process.env, HOME: home, ZDOTDIR: userZdot },
        interactiveShell: true,
      })
      prepared.commit('pty-zsh')
      const result = await run(prepared.command, prepared.args, {
        cwd: root,
        env: prepared.environment,
        input: '',
      })

      expect(result).toMatchObject({
        code: 29,
        signal: null,
        stdout: expect.stringContaining('ORDER=env,profile,rc,login'),
      })
      expect(result.stdout).toContain('CODEX=<--zsh-hook>')
      await prepared.dispose()
      await assets.dispose()
      await gateway.dispose()
    },
  )

  it('survives bash rc PATH replacement and preserves real binary, args, and exit code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-terminal-shim-'))
    roots.push(root)
    const home = join(root, 'home')
    const realBin = join(root, 'real bin')
    await mkdir(home)
    await mkdir(realBin)
    const bashRcPath = join(home, '.bashrc')
    const bashRc = `export PATH=${JSON.stringify(`${realBin}:/usr/bin:/bin`)}\nexport USER_RC_SENTINEL=loaded\n`
    await writeFile(bashRcPath, bashRc)
    const realClaude = join(realBin, 'claude')
    await writeFile(
      realClaude,
      '#!/bin/sh\nprintf "REAL=%s\\n" "$0"\nprintf "ARGS=<%s><%s>\\n" "$1" "$2"\nprintf "RC=%s\\n" "$USER_RC_SENTINEL"\nprintf "ELECTRON_RUN_AS_NODE=%s\\n" "$ELECTRON_RUN_AS_NODE"\nexit 37\n',
    )
    await chmod(realClaude, 0o700)

    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: () => ({
        prepareHookInjection: async () => ({
          args: ['--injected'],
          env: {},
          hookInstallState: 'installed',
        }),
      }),
    })
    const assets = new TerminalAgentTelemetryAssetStore({
      runtimeExecutable: process.execPath,
      platform: process.platform,
    })
    const service = new TerminalAgentActivityEnvironmentService({
      assets,
      gateway,
      inheritedPath: process.env.PATH ?? '',
      inheritedShell: '/bin/bash',
      platform: process.platform,
    })
    const prepared = await service.prepare({
      args: [],
      command: '/bin/bash',
      cwd: root,
      environment: { ...process.env, HOME: home },
      interactiveShell: true,
    })
    prepared.commit('pty-1')

    const result = await run(prepared.command, prepared.args, {
      cwd: root,
      env: prepared.environment,
      input: "claude 'user arg'\nexit\n",
    })

    expect(result.stdout).toContain(`REAL=${realClaude}`)
    expect(result.stdout).toContain('ARGS=<--injected><user arg>')
    expect(result.stdout).toContain('RC=loaded')
    expect(result.stdout).toContain('ELECTRON_RUN_AS_NODE=\n')
    expect(result).toMatchObject({ code: 37, signal: null })
    expect(await readFile(bashRcPath, 'utf8')).toBe(bashRc)
    const published = await assets.ensure()
    expect((await stat(published.rootDirectory)).mode & 0o777).toBe(0o700)
    expect(existsSync(join(published.shimDirectory, 'pi'))).toBe(false)
    expect(existsSync(join(published.shimDirectory, 'kimi'))).toBe(false)
    await prepared.dispose()
    await assets.dispose()
    await gateway.dispose()
  })

  it('waits for hook planning before launching the real provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-terminal-shim-planning-'))
    roots.push(root)
    const realBin = join(root, 'real')
    await mkdir(realBin)
    const realClaude = join(realBin, 'claude')
    await writeFile(realClaude, '#!/bin/sh\nprintf "ARG=%s\\n" "$1"\n')
    await chmod(realClaude, 0o700)
    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: () => ({
        prepareHookInjection: async () => {
          await new Promise(resolve => setTimeout(resolve, 1_700))
          return {
            args: ['--delayed-hook'],
            env: {},
            hookInstallState: 'installed',
          }
        },
      }),
    })
    const terminal = await gateway.reserveTerminal()
    terminal.commit('pty-delayed')
    const assets = new TerminalAgentTelemetryAssetStore({
      runtimeExecutable: process.execPath,
      platform: process.platform,
    })
    const published = await assets.ensure()

    const result = await run(process.execPath, [published.launcherPath, 'claude'], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENCOVE_TERMINAL_AGENT_ENDPOINT: terminal.endpoint,
        OPENCOVE_TERMINAL_AGENT_TOKEN: terminal.token,
        OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY: published.shimDirectory,
        PATH: `${published.shimDirectory}:${realBin}:/usr/bin:/bin`,
      },
    })

    expect(result).toMatchObject({ code: 0, signal: null })
    expect(result.stdout).toContain('ARG=--delayed-hook')
    await terminal.dispose()
    await assets.dispose()
    await gateway.dispose()
  })

  it('skips canonical aliases of its own directory and forwards SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-terminal-shim-signal-'))
    roots.push(root)
    const realBin = join(root, 'real')
    await mkdir(realBin)
    const realClaude = join(realBin, 'claude')
    await writeFile(
      realClaude,
      '#!/bin/sh\ntrap \'printf "FORWARDED\\n"; exit 23\' TERM\nprintf "READY\\n"\nwhile :; do sleep 1; done\n',
    )
    await chmod(realClaude, 0o700)
    const assets = new TerminalAgentTelemetryAssetStore({
      runtimeExecutable: process.execPath,
      platform: process.platform,
    })
    const published = await assets.ensure()
    const shimAlias = join(root, 'shim-alias')
    await (await import('node:fs/promises')).symlink(published.shimDirectory, shimAlias)
    const child = spawn(process.execPath, [published.launcherPath, 'claude'], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENCOVE_TERMINAL_AGENT_ENDPOINT: 'http://127.0.0.1:1/unavailable',
        OPENCOVE_TERMINAL_AGENT_TOKEN: 'unavailable',
        OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY: published.shimDirectory,
        PATH: `${shimAlias}:${published.shimDirectory}:${realBin}:/usr/bin:/bin`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => {
      output += String(chunk)
      if (output.includes('READY')) {
        child.kill('SIGTERM')
      }
    })
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve({ code, signal }))
      },
    )

    expect(output).toContain('READY')
    expect(output).toContain('FORWARDED')
    expect(result).toEqual({ code: 23, signal: null })
    await assets.dispose()
  })
})
