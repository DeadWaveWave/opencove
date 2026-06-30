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

  it('includes dynamic imports in runtime boundary checks', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "export async function load() {\n  return await import('@app/main/bootstrap')\n}\n",
      'src/app/main/bootstrap.ts': 'export const bootstrap = true\n',
      'src/contexts/workspace/presentation/renderer/View.ts':
        "export async function loadElectron() {\n  return import('electron')\n}\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'architecture.domainNoOuterRuntime',
          severity: 'error',
          file: 'src/contexts/workspace/domain/model.ts',
        }),
        expect.objectContaining({
          ruleId: 'architecture.rendererNoElectronRuntime',
          severity: 'error',
          file: 'src/contexts/workspace/presentation/renderer/View.ts',
        }),
      ]),
    )
  })

  it('includes statically resolvable dynamic import variants in boundary checks', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "export async function load() {\n  return import('@app/main/bootstrap', { with: { type: 'json' } })\n}\n",
      'src/app/main/bootstrap.ts': 'export const bootstrap = true\n',
      'src/contexts/workspace/presentation/renderer/View.ts':
        'export async function loadElectron() {\n  return import(`electron`)\n}\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'architecture.domainNoOuterRuntime',
          severity: 'error',
          file: 'src/contexts/workspace/domain/model.ts',
        }),
        expect.objectContaining({
          ruleId: 'architecture.rendererNoElectronRuntime',
          severity: 'error',
          file: 'src/contexts/workspace/presentation/renderer/View.ts',
        }),
      ]),
    )
  })

  it('includes dynamic imports in runtime file cycle checks', async () => {
    const root = await createFixture({
      'src/shared/a.ts': "export async function a() { return import('./b') }\n",
      'src/shared/b.ts': "import { a } from './a'\nexport const b = a\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations[0]).toMatchObject({
      ruleId: 'architecture.fileRuntimeCycle',
      severity: 'error',
    })
  })

  it('reports type-only forbidden imports by default', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "import type { BrowserWindow } from 'electron'\nexport type Model = BrowserWindow\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.domainNoOuterRuntime',
        severity: 'error',
        file: 'src/contexts/workspace/domain/model.ts',
        found: 'electron',
      }),
    ])
  })

  it('reports type query forbidden imports by default', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "type BrowserWindowRef = import('electron').BrowserWindow\nexport type Model = BrowserWindowRef\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.domainNoOuterRuntime',
        severity: 'error',
        file: 'src/contexts/workspace/domain/model.ts',
        found: 'electron',
      }),
    ])
  })

  it('allows explicit forbidden rules to ignore type-only imports', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "import type { BrowserWindow } from 'electron'\nexport type Model = BrowserWindow\n",
    })
    const config = await loadArchitectureConfig()
    const ignoreTypeOnlyConfig = {
      ...config,
      checks: {
        ...config.checks,
        forbiddenImportSpecifiers: config.checks.forbiddenImportSpecifiers.map(rule =>
          rule.id === 'architecture.domainNoOuterRuntime'
            ? { ...rule, ignoreTypeOnly: true }
            : rule,
        ),
      },
    }

    const report = await runArchitectureAudit({ root, config: ignoreTypeOnlyConfig })
    expect(report.violations).toEqual([])
  })

  it('ignores pure inline type imports when type-only layer edges are ignored', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "import { type Store } from '../infrastructure/store'\nexport type Model = Store\n",
      'src/contexts/workspace/infrastructure/store.ts': 'export type Store = { id: string }\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([])
  })

  it('keeps mixed inline type imports as runtime layer edges', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "import { type Store, loadStore } from '../infrastructure/store'\nexport type Model = Store\nexport const model = loadStore()\n",
      'src/contexts/workspace/infrastructure/store.ts':
        "export type Store = { id: string }\nexport function loadStore(): Store { return { id: '1' } }\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.layerDependency',
        severity: 'warn',
        file: 'src/contexts/workspace/domain/model.ts',
      }),
    ])
  })

  it('ignores pure inline type re-exports when type-only layer edges are ignored', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "export { type Store } from '../infrastructure/store'\n",
      'src/contexts/workspace/infrastructure/store.ts': 'export type Store = { id: string }\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([])
  })

  it('keeps mixed inline type re-exports as runtime layer edges', async () => {
    const root = await createFixture({
      'src/contexts/workspace/domain/model.ts':
        "export { type Store, loadStore } from '../infrastructure/store'\n",
      'src/contexts/workspace/infrastructure/store.ts':
        "export type Store = { id: string }\nexport function loadStore(): Store { return { id: '1' } }\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.layerDependency',
        severity: 'warn',
        file: 'src/contexts/workspace/domain/model.ts',
      }),
    ])
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
