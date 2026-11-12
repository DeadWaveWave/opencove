// @vitest-environment node
import fs from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { claudeTranscriptAccess } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-access-'))
  const config = join(root, 'config'),
    project = join(config, 'projects', 'workspace'),
    path = join(project, 'provider.jsonl')
  await fs.mkdir(project, { recursive: true })
  await fs.writeFile(path, '{}\n')
  cleanup.push(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, config, project, path, access: claudeTranscriptAccess(path, 'provider', [config]) }
}
it('a legitimate launch-scoped transcript opens as a regular file and closes cleanly', async () => {
  const f = await fixture(),
    handle = await f.access.open()
  expect((await handle.stat()).isFile()).toBe(true)
  expect(await handle.readFile('utf8')).toBe('{}\n')
  await handle.close()
})
it.each([
  'outside',
  'prefix-sibling',
  'wrong-name',
  'leaf-inside',
  'leaf-outside',
  'parent-escape',
  'directory',
  ...(process.platform === 'win32' ? [] : ['fifo']),
])('unsafe transcript selection never reaches open: %s', async kind => {
  const f = await fixture()
  let path = f.path
  if (kind === 'outside') {
    path = join(f.root, 'provider.jsonl')
    await fs.writeFile(path, '{}')
  }
  if (kind === 'prefix-sibling') {
    const dir = join(f.config, 'projects-other')
    await fs.mkdir(dir)
    path = join(dir, 'provider.jsonl')
    await fs.writeFile(path, '{}')
  }
  if (kind === 'wrong-name') {
    path = join(f.project, 'other.jsonl')
    await fs.writeFile(path, '{}')
  }
  if (kind.startsWith('leaf-')) {
    const target = join(kind === 'leaf-inside' ? f.project : f.root, 'target.jsonl')
    await fs.writeFile(target, '{}')
    await fs.rm(path)
    await fs.symlink(target, path)
  }
  if (kind === 'parent-escape') {
    await fs.rm(f.project, { recursive: true })
    const outside = join(f.root, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'provider.jsonl'), '{}')
    await fs.symlink(outside, f.project, process.platform === 'win32' ? 'junction' : 'dir')
  }
  if (kind === 'directory') {
    await fs.rm(path)
    await fs.mkdir(path)
  }
  if (kind === 'fifo') {
    await fs.rm(path)
    execFileSync('mkfifo', [path])
  }
  const open = vi.spyOn(fs, 'open')
  await expect(claudeTranscriptAccess(path, 'provider', [f.config]).open()).rejects.toMatchObject({
    code: 'UNSAFE_TRANSCRIPT',
  })
  expect(open).not.toHaveBeenCalled()
})
it('a valid attachment replaced by a symlink is rejected on its next read', async () => {
  const f = await fixture()
  await f.access.validate()
  const target = join(f.root, 'outside')
  await fs.writeFile(target, '{}')
  await fs.rm(f.path)
  await fs.symlink(target, f.path)
  const open = vi.spyOn(fs, 'open')
  await expect(f.access.open()).rejects.toMatchObject({ code: 'UNSAFE_TRANSCRIPT' })
  expect(open).not.toHaveBeenCalled()
})
it('descriptor identity substitution is rejected before reading and the handle is closed', async () => {
  const f = await fixture(),
    actualOpen = fs.open.bind(fs)
  const wrong = join(f.project, 'other.jsonl')
  await fs.writeFile(wrong, '{}')
  const handle = await actualOpen(wrong, 'r'),
    close = vi.spyOn(handle, 'close'),
    read = vi.spyOn(handle, 'read')
  vi.spyOn(fs, 'open').mockResolvedValueOnce(handle)
  await expect(f.access.open()).rejects.toMatchObject({ code: 'UNSAFE_TRANSCRIPT' })
  expect(read).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})
it.skipIf(process.platform === 'win32')(
  'a FIFO substituted between validation and open cannot block or reach read',
  async () => {
    const f = await fixture(),
      actualOpen = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementationOnce(async (path, flags) => {
      await fs.rm(f.path)
      execFileSync('mkfifo', [f.path])
      return await actualOpen(path, flags)
    })
    await expect(f.access.open()).rejects.toMatchObject({ code: 'UNSAFE_TRANSCRIPT' })
  },
)
it('canonical target spellings of a symlinked trusted config are authorized and roots are cached', async () => {
  const f = await fixture(),
    alias = join(f.root, 'alias')
  await fs.symlink(f.config, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const canonical = await fs.realpath(f.path),
    metadata = vi.spyOn(fs, 'realpath')
  const access = claudeTranscriptAccess(canonical, 'provider', [alias])
  const one = await access.open()
  await one.close()
  metadata.mockClear()
  const two = await access.open()
  await two.close()
  expect(metadata.mock.calls.map(([path]) => String(path))).toEqual([canonical, canonical])
})
it.skipIf(process.platform !== 'darwin')(
  'the canonical /private spelling of an authorized /var root is equivalent',
  async () => {
    const f = await fixture(),
      canonical = await fs.realpath(f.path)
    const alias = f.config.replace(/^\/private\/var\//, '/var/')
    const handle = await claudeTranscriptAccess(canonical, 'provider', [alias]).open()
    await handle.close()
  },
)
