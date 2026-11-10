// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { writeLineageAgentStub } from '../../e2e/cli.agent-lineage.helpers'

it('generates a file URL for the provider ESM import on every platform', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove lineage #esm-'))
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  try {
    const script = await readFile(await writeLineageAgentStub(root), 'utf8')
    const specifier = JSON.parse(script.match(/await import\(([^\n]+)\)/)![1]) as string
    // Absolute Windows drive paths are not valid ESM URLs; file URLs also encode spaces and #.
    const url = new URL(specifier)
    expect(url.protocol).toBe('file:')
    expect(fileURLToPath(url)).toBe(resolve('scripts/test-agent-session-stub.mjs'))
  } finally {
    cwd.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
