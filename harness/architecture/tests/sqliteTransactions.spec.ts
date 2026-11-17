import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { expect, it } from 'vitest'
import { runArchitectureAudit } from '../lib/architecture-rules.mjs'
import { VARIANT_SOURCE_FILES } from './variantFixtureSupport'

async function auditTransactions(files: Record<string, string>) {
  const root = await mkdtemp(join(process.cwd(), 'node_modules/sqlite-architecture-'))
  try {
    for (const [name, contents] of Object.entries({ ...VARIANT_SOURCE_FILES, ...files })) {
      await mkdir(dirname(join(root, name)), { recursive: true })
      await writeFile(join(root, name), contents)
    }
    const report = await runArchitectureAudit({ root })
    return report.violations.filter(item => item.ruleId === 'architecture.sqliteWriteTransaction')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it.each([
  'db.transaction(() => { db.prepare("SELECT 1").get(); db.prepare("DELETE FROM t").run() })()',
  'db.transaction(write).deferred()',
  'const write = db.transaction(operation); write()',
  'db["transaction"](write)()',
  'const transaction = db.transaction; transaction(write)()',
])('rejects a transaction without an immediate write lock: %s', async source => {
  expect(await auditTransactions({ 'src/platform/write.ts': source })).toEqual([
    expect.objectContaining({ severity: 'error', file: 'src/platform/write.ts', line: 1 }),
  ])
})

it('allows immediate and exclusive modes, including a retained callable', async () => {
  expect(
    await auditTransactions({
      'src/platform/write.ts': `
        db.transaction(write).immediate()
        db.transaction(write).exclusive()
        const writeTx = db.transaction(write).immediate
        writeTx()
        // db.transaction(write)()
        const example = 'db.transaction(write)()'
      `,
    }),
  ).toEqual([])
})

it('scopes read-only exceptions to the named function and file', async () => {
  expect(
    await auditTransactions({
      'src/platform/persistence/sqlite/PersistenceStore.ts': `
        const readAppStateSnapshot = () => db.transaction(read)()
        const writeAppState = () => db.transaction(write)()
      `,
      'src/platform/persistence/sqlite/managedClaudeResumeRead.ts': `
        const definitive = () => db.transaction(read)()
      `,
      'src/platform/other.ts': 'const readAppStateSnapshot = () => db.transaction(write)()',
    }),
  ).toEqual([
    expect.objectContaining({ file: 'src/platform/other.ts' }),
    expect.objectContaining({ file: 'src/platform/persistence/sqlite/PersistenceStore.ts' }),
  ])
})
