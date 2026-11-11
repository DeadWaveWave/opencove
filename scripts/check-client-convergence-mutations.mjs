#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Mutate isolated copies only: never rewrite source beneath another developer or running E2E.
const root = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'opencove-convergence-mutations-'))
const persistence = 'src/contexts/workspace/presentation/renderer/utils/persistence/'
const model = 'tests/integration/recovery/clientConvergence.model.spec.tsx'
const mutations = [
  {
    id: 'I1',
    file: 'src/app/renderer/shell/hooks/useWorkerSyncStateUpdates.ts',
    from: 'if (demand || getPendingPublication())',
    to: 'if (getPendingPublication())',
    test: model,
    filter: 'owned=false adapter=local trace=99 ',
  },
  {
    id: 'I2',
    file: persistence + 'write.ts',
    from: 'acceptPublicationBase(state, result.revision ?? null)',
    to: 'acceptPublicationBase(state, (result.revision ?? 0) + 1)',
    test: model,
    filter: 'owned=false adapter=local trace=3 ',
  },
  {
    id: 'I3',
    file: persistence + 'publicationState.ts',
    from: "return value?.unknownOutcome === true || value?.blockedReason === 'conflict'",
    to: 'return false',
    test: model,
    filter: 'owned=false adapter=local trace=88 ',
  },
  {
    id: 'I4',
    file: 'src/shared/sync/revisionedSnapshotCache.ts',
    from: 'if (!this.latest || revision > this.latest.revision)',
    to: 'if (!this.latest)',
    test: model,
    filter: 'owned=false adapter=remote trace=3 ',
  },
  {
    id: 'I5',
    file: 'src/shared/sync/managedClaudeResumeProjection.ts',
    from: 'resumeSessionId: agent.resumeSessionId,',
    to: 'resumeSessionId: localAgent?.resumeSessionId ?? agent.resumeSessionId,',
    test: model,
    filter: 'owned=true adapter=local trace=110 ',
  },
  {
    id: 'I6',
    file: 'src/shared/sync/canonicalizePersistedAppState.ts',
    from: 'return stripPersistedAppViewState(state)',
    to: 'return state',
    test: model,
    filter: 'owned=false adapter=local trace=3 ',
  },
  {
    id: 'I8',
    file: persistence + 'drain.ts',
    from: "const captured = 'editGeneration' in input ? input : capturePublication(input)",
    to: "return true\n  const captured = 'editGeneration' in input ? input : capturePublication(input)",
    test: model,
    filter: 'owned=false adapter=local trace=111 ',
  },
  {
    id: 'I9',
    marker: 'I1:',
    file: persistence + 'toPersistedState.ts',
    from: '    settings,',
    to: '    settings: { ...settings, sidebarCollapsedSpaceGroupIds: {} },',
    test: model,
    filter: 'owned=false adapter=local trace=113 ',
  },
  {
    id: 'I10',
    file: persistence + 'publicationQueue.ts',
    from: 'tail ? tail.then(execute) : execute()',
    to: 'execute()',
    test: model,
    filter: 'owned=false adapter=local trace=116 ',
  },
  {
    id: 'I11',
    file: 'src/shared/sync/canonicalizePersistedAppState.ts',
    from: 'a.order - b.order || compareId(a.space, b.space)',
    to: '0',
    test: model,
    filter: 'owned=false adapter=remote trace=117 ',
  },
  {
    id: 'I7',
    file: persistence + 'toPersistedState.ts',
    from: 'title: node.data.title,',
    to: "title: node.data.title + ' mutated',",
    test: 'tests/integration/recovery/clientConvergence.legacy.spec.tsx',
    filter: 'matches legacy.*local.*:3$',
  },
]
function run(test, filter, logName) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', test, '-t', filter],
    { cwd: directory, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  )
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  writeFileSync(path.join(directory, logName), output)
  if (result.error) {
    throw result.error
  }
  return { status: result.status, output }
}
try {
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
  for (const file of files) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    copyFileSync(path.join(root, file), path.join(directory, file))
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
  const smoke = run(model, 'owned=false adapter=local trace=(3|111|113|116|117) ', 'unmutated.log')
  if (smoke.status !== 0) {
    throw new Error(`Unmutated explorer failed; inspect ${directory}/unmutated.log`)
  }
  for (const mutation of mutations) {
    const target = path.join(directory, mutation.file),
      source = readFileSync(target, 'utf8')
    if (!source.includes(mutation.from)) {
      throw new Error(`Mutation ${mutation.id} no longer matches its source`)
    }
    try {
      writeFileSync(target, source.replace(mutation.from, mutation.to))
      const result = run(mutation.test, mutation.filter, `${mutation.id}.log`)
      if (result.status === 0 || !result.output.includes(mutation.marker ?? `${mutation.id}:`)) {
        throw new Error(
          `Mutation ${mutation.id} survived or failed for another reason; inspect ${directory}/${mutation.id}.log`,
        )
      }
      process.stdout.write(`${mutation.id}: killed by the real explorer\n`)
    } finally {
      writeFileSync(target, source)
    }
  }
  process.stdout.write(`11/11 source mutants killed. Logs: ${directory}\n`)
} catch (error) {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
} finally {
  // Keep the diagnostic logs, not a second source tree or dependency link.
  for (const name of ['src', 'tests', 'scripts', 'docs', 'harness', 'node_modules']) {
    rmSync(path.join(directory, name), { recursive: true, force: true })
  }
}
