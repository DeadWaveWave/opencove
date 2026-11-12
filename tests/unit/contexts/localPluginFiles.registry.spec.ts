import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LocalPluginFiles } from '@contexts/plugins/infrastructure/LocalPluginFiles'
it('keeps registry contents and private paths in the originating cause', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-registry-'))
  try {
    await mkdir(join(root, 'plugins'))
    await writeFile(
      join(root, 'plugins', 'installed.json'),
      'PRIVATE_REGISTRY_TOKEN is invalid JSON',
    )
    const error = await new LocalPluginFiles(root).readRegistry().catch(caught => caught)
    expect(error.message).toBe('Cannot read installed plugin registry.')
    expect(error.message).not.toContain('PRIVATE_REGISTRY_TOKEN')
    expect(error.message).not.toContain(root)
    expect(error.cause).toBeInstanceOf(SyntaxError)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
