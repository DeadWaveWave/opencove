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

  it('allows the configured renderer composition adapter to inject an application owner', async () => {
    const root = await createFixture({
      'src/app/renderer/shell/hooks/useWorkspaceMountRepair.ts':
        "import { owner } from '@contexts/workspace/application/mountRepair/WorkspaceMountRepairOwner'\nimport { render } from '@contexts/workspace/presentation/renderer/view'\nexport const app = render(owner)\n",
      'src/contexts/workspace/application/mountRepair/WorkspaceMountRepairOwner.ts':
        'export const owner = {}\n',
      'src/contexts/workspace/presentation/renderer/view.ts':
        'export const render = (value: unknown) => value\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([])
  })

  it('does not grant application dependencies to every renderer file', async () => {
    const root = await createFixture({
      'src/app/renderer/feature.ts':
        "import { owner } from '@contexts/workspace/application/owner'\nexport const value = owner\n",
      'src/contexts/workspace/application/owner.ts': 'export const owner = {}\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.layerDependency',
        file: 'src/app/renderer/feature.ts',
      }),
    ])
  })

  it('does not let an allowlisted composition source import unrelated targets', async () => {
    const root = await createFixture({
      'src/app/renderer/shell/hooks/useWorkspaceMountRepair.ts':
        "import { unrelated } from '@contexts/workspace/application/unrelated'\nexport const value = unrelated\n",
      'src/app/worker/workerWebAccessRuntime.ts':
        "import { unrelated } from '@contexts/settings/application/unrelated'\nexport const value = unrelated\n",
      'src/contexts/workspace/application/unrelated.ts': 'export const unrelated = {}\n',
      'src/contexts/settings/application/unrelated.ts': 'export const unrelated = {}\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.layerDependency',
        file: 'src/app/renderer/shell/hooks/useWorkspaceMountRepair.ts',
      }),
      expect.objectContaining({
        ruleId: 'architecture.layerDependency',
        file: 'src/app/worker/workerWebAccessRuntime.ts',
      }),
    ])
  })

  it('allows the Worker process root to compose application ports and infrastructure adapters', async () => {
    const root = await createFixture({
      'src/app/worker/index.ts':
        "import { owner } from '@contexts/agent/application/services/AgentProviderRegistry'\nimport { adapter } from '@contexts/settings/infrastructure/homeWorker/homeWorkerConfig'\nexport const runtime = owner(adapter)\n",
      'src/contexts/agent/application/services/AgentProviderRegistry.ts':
        'export const owner = (value: unknown) => value\n',
      'src/contexts/settings/infrastructure/homeWorker/homeWorkerConfig.ts':
        'export const adapter = {}\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([])
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

  it('keeps shared contracts independent from context layers, including type-only imports', async () => {
    const root = await createFixture({
      'src/shared/contracts/state.ts':
        "import type { ViewState } from '@contexts/workspace/presentation/renderer/types'\nexport type State = ViewState\n",
      'src/contexts/workspace/presentation/renderer/types.ts':
        'export type ViewState = { id: string }\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.sharedNoContextDependency',
        severity: 'error',
        file: 'src/shared/contracts/state.ts',
        found: '@contexts/workspace/presentation/renderer/types',
      }),
    ])
  })

  it('rejects relative shared-to-context imports after resolving their target', async () => {
    const root = await createFixture({
      'src/shared/contracts/state.ts':
        "import type { Model } from '../../contexts/workspace/domain/model'\nexport type State = Model\n",
      'src/shared/runtime/run.ts':
        "import { model } from '../../contexts/workspace/domain/model'\nexport const run = model\n",
      'src/contexts/workspace/domain/model.ts':
        "export type Model = { id: string }\nexport const model = { id: 'one' }\n",
    })

    const report = await runArchitectureAudit({ root })
    expect(
      report.violations.filter(
        violation => violation.ruleId === 'architecture.sharedNoContextDependency',
      ),
    ).toEqual([
      expect.objectContaining({
        severity: 'error',
        file: 'src/shared/contracts/state.ts',
        found: '../../contexts/workspace/domain/model',
      }),
      expect.objectContaining({
        severity: 'error',
        file: 'src/shared/runtime/run.ts',
        found: '../../contexts/workspace/domain/model',
      }),
    ])
  })

  it('scopes forbidden import rules to configured source patterns', async () => {
    const root = await createFixture({
      'src/contexts/workspace/presentation/renderer/components/terminalNode/session.ts':
        "import type { Calibration } from '@contexts/settings/presentation/renderer/calibration'\nexport type Value = Calibration\n",
      'src/contexts/workspace/presentation/renderer/other.ts':
        "import type { Calibration } from '@contexts/settings/presentation/renderer/calibration'\nexport type Value = Calibration\n",
      'src/contexts/settings/presentation/renderer/calibration.ts':
        'export type Calibration = { value: number }\n',
    })

    const report = await runArchitectureAudit({ root })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: 'architecture.terminalRendererNoSettingsPresentation',
        file: 'src/contexts/workspace/presentation/renderer/components/terminalNode/session.ts',
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
