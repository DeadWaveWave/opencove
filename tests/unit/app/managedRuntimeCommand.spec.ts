// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it.each([false, true])(
  'finishes a one-shot command despite retained native handles (failure=%s)',
  async failure => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-runtime-command-'))
    try {
      const source = await readFile('src/app/managedRuntime/runManagedRuntimeCommand.ts', 'utf8')
      await writeFile(
        join(root, 'command.mjs'),
        ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
        }).outputText,
      )
      await writeFile(
        join(root, 'probe.mjs'),
        `
import { Worker } from 'node:worker_threads'
import { runManagedRuntimeCommand } from './command.mjs'
new Worker('setInterval(() => {}, 1000)', { eval: true })
runManagedRuntimeCommand(async () => {
  try {
    await new Promise(resolve => setTimeout(resolve, 10))
    ${failure ? "throw new Error('native verification rejected')" : "process.stdout.write('x'.repeat(262144))"}
  } finally {
    await new Promise(resolve => setTimeout(resolve, 10))
    process.stderr.write('cleanup-complete\\n')
  }
})
`,
      )
      const result = spawnSync(process.execPath, [join(root, 'probe.mjs')], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(failure ? 1 : 0)
      expect(result.stdout).toBe(failure ? '' : 'x'.repeat(262144))
      expect(result.stderr).toBe(
        failure ? 'cleanup-complete\nnative verification rejected\n' : 'cleanup-complete\n',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  15000,
)
