// @vitest-environment node
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '../../../src/platform/process/runCommand'
import { createPluginGuideResult } from '../../../src/app/cli/pluginGuide.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron') as string
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const { createPackage } = builderRequire('@electron/asar') as {
  createPackage: (source: string, destination: string) => Promise<void>
}
const HOST_GUIDE_DOCUMENTS = [
  'HOST_API.md',
  'HOST_EXTENSIONS.md',
  'THEMES.md',
  'FILESYSTEM.md',
  'CANVAS_API.md',
  'EVENTS.md',
  'SIDEBAR.md',
  'TARGETS.md',
  'COMPATIBILITY.md',
  'DISTRIBUTION.md',
  'ROADMAP.md',
]
let root: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'opencove-plugin-guide-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createFixture(name: string, readme = 'Plugin development guide') {
  const app = join(root, name)
  const cli = join(app, 'src', 'app', 'cli')
  const docs = join(app, 'docs', 'plugins')
  await mkdir(cli, { recursive: true })
  await mkdir(join(docs, 'examples'), { recursive: true })
  await copyFile(resolve('src/app/cli/pluginGuide.mjs'), join(cli, 'pluginGuide.mjs'))
  await writeFile(
    join(cli, 'guide.mjs'),
    [
      "import { createPluginGuideResult } from './pluginGuide.mjs'",
      'const result = await createPluginGuideResult(undefined, { cacheDirectory: process.argv[2] })',
      'process.stdout.write(JSON.stringify(result))',
    ].join('\n'),
  )
  await writeFile(join(docs, 'README.md'), readme)
  await writeFile(join(docs, 'AUTHORING.md'), 'Plugin authoring guide')
  await writeFile(join(docs, 'API.md'), 'Plugin API guide')
  await writeFile(join(docs, 'COMMANDS.md'), 'Plugin commands guide')
  await writeFile(join(docs, 'RUNTIME.md'), 'Plugin runtime guide')
  await writeFile(join(docs, 'VISUAL_DESIGN.md'), 'Plugin design guide')
  await Promise.all(
    HOST_GUIDE_DOCUMENTS.map(filename =>
      writeFile(join(docs, filename), `Plugin reference: ${filename}`),
    ),
  )
  await cp(resolve('docs/plugins/examples/hello-clock'), join(docs, 'examples', 'hello-clock'), {
    recursive: true,
  })
  await writeFile(join(docs, 'examples', 'plugin.json'), '{"id":"example"}')
  return { app, docs }
}

async function packFixture(app: string) {
  const archive = `${app}.asar`
  await createPackage(app, archive)
  return archive
}

function runGuide(app: string, cacheDirectory = join(root, 'cache')) {
  return runCommand(
    electronBinary,
    [join(app, 'src', 'app', 'cli', 'guide.mjs'), cacheDirectory],
    root,
    {
      timeoutMs: 5_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  )
}

describe('packaged plugin guide export', () => {
  it('exports a real ASAR into files readable by ordinary Node and reuses verified content', async () => {
    const { app } = await createFixture('app')
    const archive = await packFixture(app)
    const first = await runGuide(archive)
    expect(first.exitCode, first.stderr).toBe(0)
    const guide = JSON.parse(first.stdout)
    expect(guide.directory).toMatch(/[a-f0-9]{64}$/)
    expect(guide.directory).not.toContain('.asar')
    expect(await readFile(guide.readme, 'utf8')).toBe('Plugin development guide')
    expect(guide).not.toHaveProperty('plugins')
    expect(await readFile(join(guide.directory, 'COMMANDS.md'), 'utf8')).toBe(
      'Plugin commands guide',
    )
    expect(await readFile(join(guide.directory, 'AUTHORING.md'), 'utf8')).toBe(
      'Plugin authoring guide',
    )
    expect(await readFile(join(guide.directory, 'examples', 'plugin.json'), 'utf8')).toBe(
      '{"id":"example"}',
    )
    expect(await readFile(join(guide.directory, 'API.md'), 'utf8')).toBe('Plugin API guide')
    await Promise.all(
      HOST_GUIDE_DOCUMENTS.map(async name => {
        expect(await readFile(join(guide.directory, name), 'utf8')).toBe(
          `Plugin reference: ${name}`,
        )
      }),
    )
    expect(
      await readFile(join(guide.directory, 'examples', 'hello-clock', 'view.js'), 'utf8'),
    ).toContain('window.opencovePlugin')
    const second = await runGuide(archive)
    expect(second.exitCode, second.stderr).toBe(0)
    expect(JSON.parse(second.stdout)).toEqual(guide)
    expect(await readdir(join(root, 'cache'))).toEqual([guide.directory.split(/[\\/]/).at(-1)])
  })

  it('keeps distinct document contents in distinct immutable cache directories', async () => {
    const firstApp = await createFixture('first', 'First version')
    const secondApp = await createFixture('second', 'Second version')
    const first = await runGuide(await packFixture(firstApp.app))
    const second = await runGuide(await packFixture(secondApp.app))
    expect(first.exitCode, first.stderr).toBe(0)
    expect(second.exitCode, second.stderr).toBe(0)
    const firstGuide = JSON.parse(first.stdout)
    const secondGuide = JSON.parse(second.stdout)
    expect(firstGuide.directory).not.toBe(secondGuide.directory)
    expect(await readFile(firstGuide.readme, 'utf8')).toBe('First version')
    expect(await readFile(secondGuide.readme, 'utf8')).toBe('Second version')
  })

  it('preserves unpacked source directories even when a folder is named .asar', async () => {
    const { app, docs } = await createFixture('checkout.asar')
    const result = await runGuide(app)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).directory).toBe(docs)
    await expect(readdir(join(root, 'cache'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    'AUTHORING.md',
    'COMMANDS.md',
    'API.md',
    'examples/hello-clock/view.js',
    ...HOST_GUIDE_DOCUMENTS,
  ])(
    'does not publish documentation missing %s or return a nonexistent source path',
    async missingDocument => {
      const { app, docs } = await createFixture('incomplete')
      await rm(join(docs, missingDocument))
      await expect(createPluginGuideResult(docs)).rejects.toThrow(missingDocument)
      const result = await runGuide(await packFixture(app))
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Required plugin guide document is missing or empty')
      expect(result.stderr).toContain(missingDocument)
      expect(result.stdout).toBe('')
      await expect(readdir(join(root, 'cache'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(createPluginGuideResult(join(root, 'missing'))).rejects.toThrow(
        'Plugin guide unavailable',
      )
    },
  )

  it('reports corrupted cache content without overwriting it', async () => {
    const { app } = await createFixture('app')
    const archive = await packFixture(app)
    const first = await runGuide(archive)
    expect(first.exitCode, first.stderr).toBe(0)
    const guide = JSON.parse(first.stdout)
    await writeFile(guide.readme, 'User modified cache')
    const result = await runGuide(archive)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Plugin guide cache contents have changed')
    expect(result.stdout).toBe('')
    expect(await readFile(guide.readme, 'utf8')).toBe('User modified cache')
  })

  it('reports an unusable export destination instead of returning an archive path', async () => {
    const { app } = await createFixture('app')
    const cache = join(root, 'cache')
    await writeFile(cache, 'Existing file')
    const result = await runGuide(await packFixture(app), cache)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Plugin guide unavailable')
    expect(result.stdout).toBe('')
    expect(await readFile(cache, 'utf8')).toBe('Existing file')
  })

  it('publishes one complete snapshot when guide processes run concurrently', async () => {
    const { app } = await createFixture('app')
    const archive = await packFixture(app)
    const results = await Promise.all([runGuide(archive), runGuide(archive), runGuide(archive)])
    for (const result of results) {
      expect(result.exitCode, result.stderr).toBe(0)
    }
    const guides = results.map(result => JSON.parse(result.stdout))
    expect(guides[1]).toEqual(guides[0])
    expect(guides[2]).toEqual(guides[0])
    expect(await readdir(join(root, 'cache'))).toHaveLength(1)
  })
})
