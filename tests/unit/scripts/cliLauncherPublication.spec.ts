// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { withCliLauncherLock } from '../../../src/app/main/cli/cliLauncherLock'

it('the actual platform installer publication honors the Desktop lock and releases its own lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-publication-'))
  const windows = process.platform === 'win32'
  const target = join(root, windows ? 'opencove.cmd' : 'opencove')
  const original = '# __OPENCOVE_CLI_WRAPPER__\n# OPENCOVE_INSTALL_OWNER=desktop\n'
  try {
    await writeFile(target, original)
    let run: () => ReturnType<typeof spawnSync>
    if (windows) {
      const source = await readFile('scripts/release-assets/opencove-install.ps1', 'utf8')
      const functions = source.slice(
        source.indexOf('# Shared lease protocol'),
        source.indexOf('if ($Uninstall)'),
      )
      const script = join(root, 'publish.ps1')
      await writeFile(
        script,
        [
          "$ErrorActionPreference = 'Stop'",
          '$LauncherPath = $args[0]',
          "$CliWrapperMarker = '__OPENCOVE_CLI_WRAPPER__'",
          "$CliWrapperOwnerStandalone = 'standalone'",
          'function Test-OwnedLauncher { return $true }',
          functions,
          "Write-Launcher 'C:\\runtime\\node.exe' 'C:\\app\\out\\cli\\opencove.mjs'",
        ].join('\n'),
      )
      run = () =>
        spawnSync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          target,
        ])
    } else {
      const source = await readFile('scripts/release-assets/opencove-install.sh', 'utf8')
      const cleanup = source.slice(source.indexOf('cleanup() {'), source.indexOf('quote_sh() {'))
      const quote = source.slice(
        source.indexOf('quote_sh() {'),
        source.indexOf('\n}', source.indexOf('quote_sh() {')) + 2,
      )
      const ownership = source.slice(
        source.indexOf('read_existing_wrapper() {'),
        source.indexOf('read_launcher_metadata() {'),
      )
      const publication = source.slice(
        source.indexOf('# Same exclusive sentinel'),
        source.indexOf('\nprintf "Installed OpenCove CLI'),
      )
      run = () =>
        spawnSync('sh', [
          '-c',
          [
            'set -eu',
            'LAUNCHER_PATH=$1',
            'CLI_WRAPPER_MARKER=__OPENCOVE_CLI_WRAPPER__',
            'CLI_WRAPPER_OWNER_STANDALONE=standalone',
            'NODE_BIN=$2',
            'CLI_SCRIPT=/app/out/cli/opencove.mjs',
            cleanup,
            quote,
            ownership,
            publication,
          ].join('\n'),
          'publication-test',
          target,
          process.execPath,
        ])
    }
    await withCliLauncherLock(target, async () => {
      const blocked = run()
      expect(blocked.error).toBeUndefined()
      expect(blocked.status).not.toBe(0)
      expect(blocked.stderr?.toString()).toContain(`owner pid=${process.pid}`)
      expect(blocked.stderr?.toString()).toMatch(/age=\d+s/)
      expect(await readFile(target, 'utf8')).toBe(original)
      // The unsuccessful installer must not remove the Desktop lock.
      await expect(withCliLauncherLock(target, async () => {})).rejects.toMatchObject({
        code: 'EEXIST',
      })
    })
    const failure = new Error('publication failed')
    await expect(
      withCliLauncherLock(target, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    const published = run()
    expect(published.error).toBeUndefined()
    expect(published.status, published.stderr?.toString()).toBe(0)
    expect(await readFile(target, 'utf8')).toContain('OPENCOVE_INSTALL_OWNER=standalone')
    await withCliLauncherLock(target, async () => {})
    await writeFile(
      `${target}.lock`,
      JSON.stringify({ pid: 99999, hostname: 'crashed', createdAt: new Date().toISOString() }),
    )
    const expired = new Date(Date.now() - 121_000)
    await utimes(`${target}.lock`, expired, expired)
    // A Desktop reclaimer may be paused before replacing this expired lock.
    const claimPath = `${target}.lock.reclaim`
    const claimOwner = JSON.stringify({ pid: process.pid, token: 'desktop-reclaimer' })
    await writeFile(claimPath, claimOwner, { flag: 'wx' })
    const competingReclaimer = run()
    expect(competingReclaimer.status).not.toBe(0)
    expect(competingReclaimer.stderr?.toString()).toContain(`owner pid=${process.pid}`)
    expect(await readFile(claimPath, 'utf8')).toBe(claimOwner)
    expect(JSON.parse(await readFile(`${target}.lock`, 'utf8')).pid).toBe(99999)
    // A crashed reclaimer must not permanently block the installer either.
    await utimes(claimPath, expired, expired)
    const recovered = run()
    expect(recovered.status, recovered.stderr?.toString()).toBe(0)
    await expect(readFile(claimPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await withCliLauncherLock(target, async () => {})
  } finally {
    await rm(resolve(root), { recursive: true, force: true })
  }
})
