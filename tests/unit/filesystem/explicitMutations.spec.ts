// @vitest-environment node
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalFileSystemPort } from '../../../src/contexts/filesystem/infrastructure/localFileSystemPort'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
const paths: string[] = []
afterEach(async () => {
  await Promise.all(paths.splice(0).map(p => rm(p, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cove-files-'))
  paths.push(root)
  return { root, port: createLocalFileSystemPort() }
}
describe('explicit filesystem mutation options', () => {
  it('uses exclusive create and never truncates existing text including concurrent creates', async () => {
    const { root, port } = await fixture(),
      uri = toFileUri(join(root, 'file.txt'))
    const results = await Promise.allSettled(
      ['first', 'second'].map(content => port.writeFileText({ uri, content, overwrite: false })),
    )
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    const content = await readFile(join(root, 'file.txt'), 'utf8')
    expect(['first', 'second']).toContain(content)
    await expect(
      port.writeFileText({ uri, content: 'overwrite', overwrite: false }),
    ).rejects.toThrow()
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe(content)
    await port.writeFileText({ uri, content: 'changed', overwrite: true })
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('changed')
  })
  it('refuses nonrecursive deletion of a nonempty directory and permits explicit recursive delete', async () => {
    const { root, port } = await fixture(),
      dir = join(root, 'dir'),
      uri = toFileUri(dir)
    await mkdir(dir)
    await writeFile(join(dir, 'keep'), 'data')
    await expect(port.deleteEntry({ uri, recursive: false })).rejects.toThrow()
    expect(await readFile(join(dir, 'keep'), 'utf8')).toBe('data')
    await port.deleteEntry({ uri: toFileUri(join(dir, 'keep')), recursive: false })
    await port.deleteEntry({ uri, recursive: false })
    await mkdir(dir)
    await writeFile(join(dir, 'remove'), 'data')
    await port.deleteEntry({ uri, recursive: true })
    await expect(readFile(join(dir, 'remove'))).rejects.toThrow()
  })
})
