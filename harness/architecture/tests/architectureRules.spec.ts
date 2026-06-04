import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatArchitectureReport,
  loadArchitectureConfig,
  runArchitectureAudit,
} from '../lib/architecture-rules.mjs'

const tempRoots: string[] = []

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-rules-'))
  tempRoots.push(root)
  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const filePath = join(root, relativePath)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, source, 'utf8')
    }),
  )
  return root
}

describe('architecture rules audit', () => {
  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  it('reports layer drift and renderer boundary global usage', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "import { loadWorkspace } from '../infrastructure/store'\nexport const value = loadWorkspace()\n",
      'src/contexts/workspace/infrastructure/store.ts':
        'export function loadWorkspace() { return 1 }\n',
      'src/contexts/workspace/presentation/renderer/View.ts':
        'export function run() {\n  return window.opencoveApi.agent.listInstalledProviders({})\n}\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.summary.errors).toBe(0)
    expect(report.violations.map(violation => violation.ruleId)).toEqual([
      'architecture.layerDependency',
      'architecture.windowOpenCoveApiBoundary',
    ])
    expect(formatArchitectureReport(report)).toContain('src/contexts/workspace/domain/model.ts:1')
  })

  it('reports runtime file cycles as errors', async () => {
    const root = await createFixture({
      'src/shared/a.ts': "import { b } from './b'\nexport const a = b\n",
      'src/shared/b.ts': "import { a } from './a'\nexport const b = a\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.summary.errors).toBe(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: 'architecture.fileRuntimeCycle',
      severity: 'error',
    })
  })

  it('respects configured allowlists for boundary adapters', async () => {
    const root = await createFixture({
      'src/app/renderer/browser/browserOpenCoveApi.ts': 'window.opencoveApi = {} as never\n',
      'src/contexts/workspace/presentation/renderer/workspaceApi.ts':
        'export const api = window.opencoveApi.workspace\n',
    })

    const report = await runArchitectureAudit({ root, config: await loadArchitectureConfig() })
    expect(report.violations).toEqual([])
  })
})
