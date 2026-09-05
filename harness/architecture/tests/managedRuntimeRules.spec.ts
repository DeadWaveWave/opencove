/* eslint-disable no-await-in-loop -- Create each fixture parent before its source file. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { runArchitectureAudit } from '../lib/architecture-rules.mjs'

it('keeps managed runtime composition separate from renderer and application policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-managed-architecture-'))
  try {
    const files = {
      'src/app/managedRuntime/index.ts':
        "import { owner } from '../../contexts/topology/application/owner'\nimport { view } from '../renderer/view'\nexport const result = [owner, view]",
      'src/contexts/topology/application/owner.ts': 'export const owner = {}',
      'src/app/renderer/view.ts': 'export const view = {}',
    }
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, name)), { recursive: true })
      await writeFile(join(root, name), contents)
    }
    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.layerDependency',
        file: 'src/app/managedRuntime/index.ts',
      }),
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
