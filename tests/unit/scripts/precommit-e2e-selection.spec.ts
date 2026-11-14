// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseStagedE2EChanges,
  QUICK_E2E_GROUPS,
  selectPrecommitE2E,
  shouldRunWorkerCliContracts,
} from '../../../scripts/precommit-e2e-selection.mjs'

const root = resolve(import.meta.dirname, '../../..')
const changed = (path: string, status = 'M') => ({ path, status })
const select = (...paths: string[]) =>
  selectPrecommitE2E({ changes: paths.map(path => changed(path)) })

describe('local quick E2E selection', () => {
  it('keeps the invariant core for every quick selection and selects every registered group with real existing files', () => {
    const examples = {
      workerCli: 'src/app/cli/commands/agent.ts',
      plugins: 'src/contexts/settings/presentation/renderer/settingsPanel/PluginSettingsDetail.tsx',
      pluginInteraction: 'tests/e2e/plugins.local.helpers.ts',
      liveViews: 'src/app/renderer/shell/hooks/useWorkerSyncStateUpdates.ts',
      windows:
        'src/contexts/workspace/presentation/renderer/components/shared/CanvasNodeWindow.tsx',
      spaces: 'src/contexts/space/application/spaceLayout.ts',
      managedClaude: 'src/app/main/controlSurface/managedClaudeDeliveryRuntime.ts',
      connections: 'src/app/main/controlSurface/http/requestAuth.ts',
      persistence: 'src/shared/sync/mergePersistedAppStates.ts',
      sidebar: 'src/app/renderer/styles/workspace-sidebar.css',
      settings: 'src/app/renderer/styles/settings-panel.css',
      filesystem: 'src/contexts/filesystem/presentation/renderer/DirectoryBrowser.tsx',
    }
    expect(Object.keys(examples).sort()).toEqual(
      Object.keys(QUICK_E2E_GROUPS)
        .filter(id => id !== 'core')
        .sort(),
    )
    for (const [id, path] of Object.entries(examples)) {
      const result = select(path)
      expect(result.groups.map(group => group.id)).toContain(id)
      for (const coreTest of QUICK_E2E_GROUPS.core.tests) {
        expect(result.tests).toContain(coreTest)
      }
    }
    for (const group of Object.values(QUICK_E2E_GROUPS)) {
      for (const test of group.tests) {
        expect(existsSync(resolve(root, test)), `Registered E2E does not exist: ${test}`).toBe(true)
      }
    }
  })

  it('selects plugin, settings, shared-window and connection coverage once for the independent plugin changes', () => {
    const result = select(
      'src/contexts/plugins/application/PluginInstallationManager.ts',
      'src/contexts/settings/presentation/renderer/settingsPanel/PluginSettingsDetail.tsx',
      'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation.tsx',
      'src/app/main/controlSurface/pluginAssetRoutes.ts',
      'src/app/renderer/styles/settings-panel.plugins.css',
      'electron.vite.config.ts',
    )
    expect(result.groups.map(group => group.id)).toEqual(
      expect.arrayContaining(['core', 'plugins', 'settings', 'windows', 'connections', 'expanded']),
    )
    expect(result.tests).toEqual(expect.arrayContaining(QUICK_E2E_GROUPS.plugins.tests))
    expect(new Set(result.tests).size).toBe(result.tests.length)
    // Includes the host command, preference and theme contribution regression.
    expect(result.tests.length).toBeLessThanOrEqual(15)
    expect(result.tests).toContain('tests/e2e/plugins.themes.spec.ts')
  })

  it('includes CSS and expands unknown source, deleted files and configuration without dropping the core', () => {
    expect(
      select('src/app/renderer/styles/canvas-node-window.css').groups.map(group => group.id),
    ).toContain('windows')
    for (const change of [
      changed('src/contexts/future/application/newOwner.ts'),
      changed('src/contexts/plugins/application/oldOwner.ts', 'D'),
      changed('package.json'),
      changed('pnpm-lock.yaml'),
      changed('tsconfig.web.json'),
      changed('.github/workflows/ci.yml'),
      changed('scripts/new-build.mjs'),
    ]) {
      const result = selectPrecommitE2E({ changes: [change] })
      expect(result.groups.map(group => group.id)).toContain('expanded')
      expect(result.tests).toEqual(expect.arrayContaining(QUICK_E2E_GROUPS.core.tests))
      expect(result.tests).toContain(
        'tests/e2e/workspace-canvas.desktop-web-terminal-consistency.spec.ts',
      )
    }
  })

  it('runs changed E2Es, never invokes a deleted test directly, and labels non-runtime paths honestly', () => {
    const file = 'tests/e2e/future-case.spec.ts'
    expect(select(file).tests).toContain(file)
    expect(selectPrecommitE2E({ changes: [changed(file, 'D')] }).tests).not.toContain(file)
    const docs = select('docs/new-guide.md')
    expect(docs.tests).toEqual(QUICK_E2E_GROUPS.core.tests)
    expect(docs.unmatchedPaths).toEqual(['docs/new-guide.md'])
  })

  it('rejects empty quick input while explicit full mode runs without any quick filters', () => {
    expect(() => selectPrecommitE2E({ changes: [] })).toThrow('checked NOTHING')
    for (const changes of [
      [],
      [changed('src/contexts/plugins/application/PluginInstallationManager.ts')],
    ]) {
      expect(selectPrecommitE2E({ changes, full: true })).toEqual({
        mode: 'full',
        groups: [],
        tests: [],
      })
    }
  })

  it('parses deletion, renames, copies and paths containing spaces from NUL-delimited git output', () => {
    expect(
      parseStagedE2EChanges(
        'M\0src/file with spaces.ts\0D\0src/old.ts\0R100\0src/from.ts\0src/to.ts\0C80\0src/base.ts\0src/copy.ts\0',
      ),
    ).toEqual([
      changed('src/file with spaces.ts'),
      changed('src/old.ts', 'D'),
      changed('src/from.ts', 'D'),
      changed('src/to.ts', 'A'),
      changed('src/base.ts'),
      changed('src/copy.ts', 'A'),
    ])
    expect(parseStagedE2EChanges('')).toEqual([])
    expect(() => parseStagedE2EChanges('R100\0src/old.ts\0')).toThrow('Incomplete')
    expect(() => parseStagedE2EChanges('not-status\0src/file.ts\0')).toThrow('Invalid')
  })
})

it.each([
  'src/app/renderer/shell/hooks/useWorkerSyncStateUpdates.ts',
  'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context.ts',
  'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.tsx',
  'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeTypes.ts',
])('includes all plugin and website-window lifetimes when %s changes', path => {
  const chosen = select(path).tests
  const views = readdirSync(resolve(root, 'tests/e2e')).filter(name =>
    /^(plugins(?:\..*)?|workspace-canvas\.website-window(?:\..*)?)\.spec\.ts$/.test(name),
  )
  expect(views.length).toBeGreaterThan(0)
  for (const file of views) {
    expect(chosen).toContain('tests/e2e/' + file)
  }
  expect(chosen).toContain('tests/e2e/recovery.managed-claude-convergence.spec.ts')
  expect(chosen).toContain('tests/e2e/workspace-canvas.far-view.spec.ts')
})

it.each([
  'src/app/main/controlSurface/managedClaudeDeliveryRuntime.ts',
  'src/app/main/controlSurface/managedClaudeClearRuntime.ts',
  'src/app/main/controlSurface/handlers/systemHandlers.ts',
  'src/contexts/agent/application/ClaudeClearResumeBinding.ts',
  'src/contexts/agent/infrastructure/watchers/ClaudeResumeTranscriptReader.ts',
  'src/shared/contracts/dto/controlSurface.ts',
])('selects deterministic managed acceptance for %s', path => {
  expect(select(path).groups.map(group => group.id)).toContain('managedClaude')
  expect(QUICK_E2E_GROUPS.managedClaude.tests).toHaveLength(4)
  expect(QUICK_E2E_GROUPS.managedClaude.tests).not.toContain(
    'tests/e2e/recovery.claude-clear.spec.ts',
  )
})

it('keeps moved contracts selected for CLI, Worker, native process and control-surface changes', () => {
  for (const path of [
    'src/app/cli/commands/agent.ts',
    'src/app/worker/index.ts',
    'src/app/main/controlSurface/handlers/nodeControlRuntime.ts',
    'src/shared/contracts/controlSurface/operations/domains/session.ts',
    'src/platform/process/pty/runtime.ts',
    'tests/contract/worker-cli/fixture.ts',
    'tests/e2e/cli.terminal-read.spec.ts',
  ]) {
    expect(shouldRunWorkerCliContracts([changed(path, 'D')]), path).toBe(true)
  }
  expect(shouldRunWorkerCliContracts([], true)).toBe(true)
  expect(shouldRunWorkerCliContracts([changed('README.md')])).toBe(false)
})

it.each(['cliSessionGrant', 'sessionGrantCases'])(
  'keeps the shared %s oracle covered by Worker and Desktop grant boundaries',
  name => {
    const path = `tests/support/${name}.ts`
    expect(shouldRunWorkerCliContracts([changed(path)])).toBe(true)
    expect(select(path).tests).toContain('tests/e2e/cli.session-grant.spec.ts')
  },
)

it.each(['boundedSpawning', 'cliLineageAgent'])(
  'keeps shared %s assertions selected in Worker contracts and Desktop boundaries',
  name => {
    const path = `tests/support/${name}.ts`
    expect(shouldRunWorkerCliContracts([changed(path)])).toBe(true)
    expect(select(path).tests).toContain('tests/e2e/cli.bounded-agent-spawning.spec.ts')
  },
)
