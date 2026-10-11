// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pluginBuildInvocation } from '../../../../src/contexts/plugins/infrastructure/pluginBuildInvocation'
import { createControlSurface } from '../../../../src/app/main/controlSurface/controlSurface'
import { registerPluginDistributionHandlers } from '../../../../src/app/main/controlSurface/handlers/pluginDistributionHandlers'
import type { ControlSurfaceContext } from '../../../../src/app/main/controlSurface/types'
import { parsePluginCommand } from '../../../../src/app/cli/commands/plugins.mjs'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInstallationManager } from '../../../../src/contexts/plugins/application/PluginInstallationManager'
import { PluginDistributionService } from '../../../../src/contexts/plugins/application/PluginDistributionService'
import { LocalPluginFiles } from '../../../../src/contexts/plugins/infrastructure/LocalPluginFiles'
import { GitPluginSources } from '../../../../src/contexts/plugins/infrastructure/GitPluginSources'
import { git } from '../../../../src/contexts/plugins/infrastructure/pluginGitCommands'

let root: string, repository: string, profile: string
const managers: PluginInstallationManager[] = []
const pkg = {
  apiVersion: 1,
  id: 'git-fixture',
  version: '1.0.0',
  displayName: 'Git fixture',
  description: 'Independent fixture',
  main: 'main.mjs',
  view: { entry: 'index.html' },
}
async function commit(directory: string, message = 'change') {
  await git(directory, ['add', '--all'])
  await git(directory, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    message,
  ])
  return git(directory, ['rev-parse', 'HEAD'])
}
function runtime(hostVersion: string | null = null) {
  const files = new LocalPluginFiles(profile, process.platform, hostVersion)
  const sources = new GitPluginSources(profile)
  const manager = new PluginInstallationManager({
    files,
    backend: {
      start: async snapshot => {
        const code = await readFile(join(snapshot.directory, 'main.mjs'), 'utf8')
        if (code === 'FAIL') {
          throw new Error('Activation fixture failed')
        }
        return { invoke: async () => code, dispose: async () => undefined }
      },
    },
    createId: randomUUID,
    reservedIds: [],
    scheduleViewExpiry: () => () => undefined,
  })
  managers.push(manager)
  return {
    manager,
    files,
    sources,
    service: new PluginDistributionService(manager, files, sources),
  }
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-plugin-git with spaces-'))
  repository = join(root, 'remote')
  profile = join(root, 'profile')
  await mkdir(repository)
  await git(repository, ['init', '-b', 'main'])
  await writeFile(join(repository, 'opencove.plugin.json'), JSON.stringify(pkg))
  await writeFile(join(repository, 'main.mjs'), 'version-one')
  await writeFile(join(repository, 'index.html'), '<html><head></head><body>original</body></html>')
  await writeFile(join(repository, 'delete-me.txt'), 'tracked')
  await commit(repository, 'initial')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
  await rm(root, { recursive: true, force: true })
})

describe('Git source, candidate and active artifact ownership', { timeout: 30_000 }, () => {
  it('keeps incompatible updates and apply candidates inactive, and rechecks retained code on rollback', async () => {
    const { service, manager, files } = runtime('0.3.2')
    await writeFile(
      join(repository, 'opencove.plugin.json'),
      JSON.stringify({ ...pkg, engines: { opencove: '>=0.3.2 <0.4.0' } }),
    )
    await commit(repository)
    const first = await service.install({ repository, ref: 'main' })
    const view = await manager.openView({ pluginId: pkg.id, nodeId: 'keep-alive' })
    const registry = await files.readRegistry()
    await writeFile(
      join(repository, 'opencove.plugin.json'),
      JSON.stringify({ ...pkg, version: '2.0.0', engines: { opencove: '>=0.4.0' } }),
    )
    await commit(repository)
    const candidate = await service.update(pkg.id)
    expect(candidate).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('requires OpenCove >=0.4.0'),
    })
    expect(await service.apply(candidate.candidateId)).toMatchObject({ status: 'failed' })
    expect(await files.readRegistry()).toEqual(registry)
    expect(await manager.invoke(view.viewId, 'read', null)).toBe('version-one')

    await writeFile(
      join(candidate.candidateDirectory, 'opencove.plugin.json'),
      JSON.stringify({ ...pkg, version: '2.0.0', engines: { opencove: '>=0.3.2 <0.5.0' } }),
    )
    await commit(candidate.candidateDirectory)
    expect(await service.apply(candidate.candidateId)).toMatchObject({ status: 'updated' })
    await manager.dispose()
    const upgraded = runtime('0.4.0')
    expect(await upgraded.manager.list()).toMatchObject([{ version: '2.0.0', status: 'ready' }])
    const beforeRollback = await upgraded.files.readRegistry()
    await expect(upgraded.service.rollback(pkg.id, first.plugin!.revision!)).rejects.toThrow(
      'requires OpenCove >=0.3.2 <0.4.0',
    )
    expect(await upgraded.files.readRegistry()).toEqual(beforeRollback)
    expect(await upgraded.manager.list()).toMatchObject([{ version: '2.0.0', status: 'ready' }])
  })

  it('pins installation, preserves dirty and committed personal edits, checks without mutation, and restores/rolls back code only', async () => {
    const { service, manager, files } = runtime()
    const initial = await service.install({ repository, ref: 'main' })
    expect(initial.status).toBe('installed')
    const installed = await service.inspect(pkg.id)
    expect(installed.distribution?.upstreamCommit).toBe(
      await git(repository, ['rev-parse', 'HEAD']),
    )
    const originalSource = installed.sourceDirectory
    await writeFile(join(originalSource, 'personal.txt'), 'personal commit')
    await commit(originalSource, 'personal')
    await writeFile(join(originalSource, 'dirty.txt'), 'untracked personal')
    await writeFile(join(originalSource, 'index.html'), '<html>dirty view</html>')
    await chmod(join(originalSource, 'main.mjs'), 0o755)
    await git(originalSource, ['rm', '--', 'delete-me.txt'])
    const before = await git(originalSource, ['status', '--porcelain'])
    await writeFile(join(repository, 'upstream.txt'), 'upstream')
    const upstream = await commit(repository)
    expect(await service.check(pkg.id)).toMatchObject({
      availableCommit: upstream,
      updateAvailable: true,
    })
    expect(await git(originalSource, ['status', '--porcelain'])).toBe(before)
    expect((await manager.list())[0].revision).toBe(initial.plugin!.revision)
    const updated = await service.update(pkg.id)
    expect(updated).toMatchObject({ status: 'updated' })
    expect(updated.candidateDirectory).not.toBe(originalSource)
    if (process.platform !== 'win32') {
      expect((await stat(join(updated.candidateDirectory, 'main.mjs'))).mode & 0o111).toBe(0o111)
    }
    await expect(readFile(join(updated.candidateDirectory, 'delete-me.txt'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    expect(await readFile(join(updated.candidateDirectory, 'personal.txt'), 'utf8')).toBe(
      'personal commit',
    )
    expect(await readFile(join(updated.candidateDirectory, 'dirty.txt'), 'utf8')).toBe(
      'untracked personal',
    )
    expect(await readFile(join(updated.candidateDirectory, 'upstream.txt'), 'utf8')).toBe(
      'upstream',
    )
    expect(await git(originalSource, ['status', '--porcelain'])).toBe(before)
    await files.writeStorage(pkg.id, 'value', { retained: true })
    await manager.dispose()
    const restarted = runtime()
    expect((await restarted.manager.list())[0].revision).toBe(updated.plugin!.revision)
    const restored = await restarted.service.rollback(pkg.id, initial.plugin!.revision!)
    expect(restored.revision).toBe(initial.plugin!.revision)
    expect((await restarted.service.inspect(pkg.id)).sourceDirectory).toBe(originalSource)
    expect(await restarted.files.readStorage(pkg.id, 'value')).toEqual({ retained: true })
    expect(await readFile(join(originalSource, 'dirty.txt'), 'utf8')).toBe('untracked personal')
  })
  it('retains a conflicting candidate, never edits/stashes source, and allows explicit resolved apply', async () => {
    const { service, manager } = runtime()
    const installed = await service.install({ repository })
    const source = (await service.inspect(pkg.id)).sourceDirectory
    await writeFile(join(source, 'index.html'), '<html>personal</html>')
    await writeFile(join(repository, 'index.html'), '<html>remote</html>')
    await commit(repository)
    const conflict = await service.update(pkg.id)
    expect(conflict.status).toBe('conflict')
    expect(await readFile(join(source, 'index.html'), 'utf8')).toBe('<html>personal</html>')
    expect((await manager.list())[0].revision).toBe(installed.plugin!.revision)
    expect(await git(conflict.candidateDirectory, ['ls-files', '--unmerged'])).not.toBe('')
    await writeFile(join(conflict.candidateDirectory, 'index.html'), '<html>resolved</html>')
    await commit(conflict.candidateDirectory, 'resolve')
    expect(await service.apply(conflict.candidateId)).toMatchObject({ status: 'updated' })
  })
  it.each(['validation', 'activation', 'registry'] as const)(
    'keeps the active generation on %s failure and retains candidate',
    async failure => {
      const { service, manager, files } = runtime()
      const installed = await service.install({ repository })
      const open = await manager.openView({ pluginId: pkg.id, nodeId: 'node' })
      if (failure === 'validation') {
        await writeFile(join(repository, 'opencove.plugin.json'), '{bad')
      } else {
        await writeFile(
          join(repository, 'main.mjs'),
          failure === 'activation' ? 'FAIL' : 'version-two',
        )
      }
      await commit(repository)
      const spy =
        failure === 'registry'
          ? vi.spyOn(files, 'writeRegistry').mockRejectedValueOnce(new Error('disk unavailable'))
          : null
      const failed = await service.update(pkg.id)
      expect(failed.status).toBe('failed')
      expect(failed.error).toBeTruthy()
      expect((await manager.list())[0].revision).toBe(installed.plugin!.revision)
      expect(await manager.invoke(open.viewId, 'status', null)).toBe('version-one')
      expect((await service.inspect(pkg.id)).candidates).toContainEqual(
        expect.objectContaining({ id: failed.candidateId, status: 'failed' }),
      )
      spy?.mockRestore()
    },
  )
  it('fences a prepared candidate after disable/re-enable, and rejects manual apply after restart', async () => {
    const { service, manager, sources } = runtime()
    await service.install({ repository })
    await writeFile(join(repository, 'main.mjs'), 'version-two')
    await commit(repository)
    const build = sources.build.bind(sources)
    vi.spyOn(sources, 'build').mockImplementationOnce(async candidate => {
      const path = await build(candidate)
      await manager.setEnabled(pkg.id, false)
      await manager.setEnabled(pkg.id, true)
      return path
    })
    const failed = await service.update(pkg.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('changed')
    await manager.dispose()
    const restarted = runtime()
    expect((await restarted.service.inspect(pkg.id)).candidates).toContainEqual(
      expect.objectContaining({ id: failed.candidateId, stale: 'installation' }),
    )
    expect(await restarted.service.apply(failed.candidateId)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('stale'),
    })
  })
  it('builds an explicit locked npm candidate while suppressing dependency lifecycle scripts', async () => {
    const { service } = runtime()
    await writeFile(
      join(repository, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        scripts: {
          preinstall: 'node preinstall.cjs',
          build: 'node build.cjs',
        },
      }),
    )
    await writeFile(
      join(repository, 'build.cjs'),
      "const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});for(const name of ['opencove.plugin.json','main.mjs','index.html']) fs.copyFileSync(name,'dist/'+name)",
    )
    await writeFile(
      join(repository, 'preinstall.cjs'),
      "require('node:fs').writeFileSync('should-not-exist','bad')",
    )
    const npm = await pluginBuildInvocation('npm')
    await promisify(execFile)(
      npm.command,
      [
        ...npm.args,
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: repository },
    )
    await commit(repository)
    const installed = await service.install({
      repository,
      build: { kind: 'npm', script: 'build', outputDirectory: 'dist' },
    })
    expect(installed.status).toBe('installed')
    await expect(
      readFile(join(installed.candidateDirectory, 'should-not-exist')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await service.inspect(pkg.id)).distribution?.build).toEqual({
      kind: 'npm',
      script: 'build',
      outputDirectory: 'dist',
    })
    await writeFile(join(repository, 'build.cjs'), 'process.exit(7)')
    await commit(repository, 'broken build')
    expect(await service.update(pkg.id)).toMatchObject({ status: 'failed' })
    expect((await service.inspect(pkg.id)).history).toEqual([])
  }, 30_000)
  it('runs CLI installation/source/check/rollback contracts through the validated facade', async () => {
    const { service } = runtime()
    const surface = createControlSurface()
    registerPluginDistributionHandlers(surface, service)
    const invoke = (args: string[]) =>
      surface.invoke({} as ControlSurfaceContext, parsePluginCommand(['plugin', ...args])!)
    const installed = await invoke(['install-git', repository, '--ref', 'main'])
    expect(installed).toMatchObject({ ok: true, value: { status: 'installed' } })
    expect(await invoke(['source', pkg.id])).toMatchObject({
      ok: true,
      value: { pluginId: pkg.id, distribution: { kind: 'git' } },
    })
    expect(await invoke(['check', pkg.id])).toMatchObject({
      ok: true,
      value: { updateAvailable: false },
    })
    expect(
      await surface.invoke({} as ControlSurfaceContext, {
        kind: 'command',
        id: 'plugin.git.update',
        payload: { pluginId: pkg.id, force: true },
      }),
    ).toMatchObject({ ok: false })
  })
  it('retains history after same-artifact publication, changed source metadata and repeated no-op reloads', async () => {
    const { service, manager, files } = runtime()
    const initial = await service.install({ repository })
    await writeFile(join(repository, 'upstream.txt'), 'new')
    await commit(repository)
    await service.update(pkg.id)
    const { record, manifest, runtimeEpoch } = await manager.installationState(pkg.id)
    const snapshot = await files.restore(record)
    delete snapshot.history
    snapshot.distribution = { ...snapshot.distribution!, ref: 'refs/heads/main' }
    await manager.publishPrepared(snapshot, {
      revision: record.revision,
      runtimeGeneration: manifest.runtimeGeneration!,
      runtimeEpoch,
      sourceDirectory: record.sourceDirectory,
    })
    expect(await service.rebuild(pkg.id)).toMatchObject({ status: 'updated' })
    expect(await service.rebuild(pkg.id)).toMatchObject({ status: 'updated' })
    const details = await service.inspect(pkg.id)
    expect(details.history.map(item => item.revision)).toContain(initial.plugin!.revision)
    expect(details.distribution?.ref).toBe('refs/heads/main')
    expect((await service.rollback(pkg.id, initial.plugin!.revision!)).revision).toBe(
      initial.plugin!.revision,
    )
  })
  it('requires explicit branch/tag refs when a name is ambiguous, including annotated tags', async () => {
    const { service } = runtime()
    await git(repository, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'tag',
      '-a',
      'main',
      '-m',
      'tag',
    ])
    await expect(service.install({ repository, ref: 'main' })).rejects.toThrow('ambiguous')
    expect((await service.install({ repository, ref: 'refs/heads/main' })).status).toBe('installed')
    const tagged = await service.update(pkg.id, 'refs/tags/main')
    expect(tagged.status).toBe('updated')
    expect((await service.inspect(pkg.id)).distribution?.upstreamCommit).toBe(
      await git(repository, ['rev-parse', 'refs/tags/main^{commit}']),
    )
  })
  it('rejects publication if the editable source changes while building', async () => {
    const { service, sources } = runtime()
    await service.install({ repository })
    const original = (await service.inspect(pkg.id)).sourceDirectory
    const build = sources.build.bind(sources)
    vi.spyOn(sources, 'build').mockImplementationOnce(async candidate => {
      const output = await build(candidate)
      await writeFile(join(original, 'concurrent.txt'), 'keep')
      return output
    })
    const failed = await service.update(pkg.id)
    expect(failed).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('source changed'),
    })
    expect((await service.inspect(pkg.id)).candidates).toContainEqual(
      expect.objectContaining({ id: failed.candidateId, stale: 'source' }),
    )
    expect((await service.inspect(pkg.id)).sourceDirectory).toBe(original)
    expect(await readFile(join(original, 'concurrent.txt'), 'utf8')).toBe('keep')
  })
})
