import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { runArchitectureAudit } from '../lib/architecture-rules.mjs'

it('blocks runtime registry and zod imports in renderer/preload but permits types', async () => {
  const root = resolve(import.meta.dirname, '../../../.codex-out/tmp/operation-architecture')
  const files = {
    'src/app/renderer/runtime.ts':
      "import { registry } from '@shared/contracts/controlSurface/operations'\nimport * as z from 'zod'\nexport const value = [registry,z]",
    'src/app/preload/runtime.ts':
      "export { registry } from '../../shared/contracts/controlSurface/operations'",
    'src/contexts/demo/presentation/renderer/runtime.ts':
      "import * as z from 'zod/mini'\nexport { z }",
    'src/app/renderer/types.ts':
      "import type { Registry } from '@shared/contracts/controlSurface/operations'\nimport type { ZodType } from 'zod'\nexport type Pair = [Registry, ZodType]",
    'src/shared/contracts/controlSurface/operations/index.ts':
      'export const registry = []; export type Registry = string',
  }
  try {
    await Promise.all(
      Object.entries(files).map(async ([name, source]) => {
        const path = resolve(root, name)
        await mkdir(resolve(path, '..'), { recursive: true })
        await writeFile(path, source)
      }),
    )
    const result = await runArchitectureAudit({ root })
    const violations = result.violations.filter(
      v => v.ruleId === 'architecture.rendererNoOperationRuntime',
    )
    expect(violations).toHaveLength(4)
    expect(violations.some(v => v.file.endsWith('/types.ts'))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
