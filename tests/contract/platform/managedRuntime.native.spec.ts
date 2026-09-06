// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { ManagedDeploymentStore } from '../../../src/contexts/topology/infrastructure/managedRuntime/ManagedDeploymentStore'
import { snapshotManagedProfile } from '../../../src/contexts/topology/infrastructure/managedRuntime/managedProfileSnapshot'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

describeWithElectronNativeModules('managed runtime native storage', () => {
  it('releases the deployment OS lock after an independent controller crashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-runtime-crash-'))
    const store = new ManagedDeploymentStore(root)
    const script = join(root, 'lock.cjs')
    const require = createRequire(import.meta.url)
    await writeFile(
      script,
      `const Database=require(${JSON.stringify(require.resolve('better-sqlite3'))});
const db=new Database(${JSON.stringify(join(root, 'activation-lock.sqlite'))});
db.exec('BEGIN EXCLUSIVE'); process.send('locked'); setInterval(()=>{},1000);`,
    )
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve())
        child.once('error', reject)
        child.once('exit', code =>
          reject(new Error(`Lock controller exited before admission (${code}).`)),
        )
      })
      let admitted = false
      const next = store.exclusive(async () => {
        admitted = true
      })
      expect(admitted).toBe(false)
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill()
      await exited
      await next
      expect(admitted).toBe(true)
    } finally {
      if (child.exitCode === null) {
        child.kill()
      }
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('retains committed WAL data and validates migration without modifying the snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-runtime-snapshot-'))
    try {
      const profile = join(root, 'profile')
      await mkdir(profile)
      const path = join(profile, 'opencove.db')
      const store = await createPersistenceStore({ dbPath: path })
      store.dispose()
      const db = new Database(path)
      db.pragma('journal_mode=WAL')
      db.pragma('wal_autocheckpoint=0')
      db.exec(
        "CREATE TABLE snapshot_probe (value TEXT); INSERT INTO snapshot_probe VALUES ('committed-in-wal')",
      )
      try {
        const snapshot = await snapshotManagedProfile(profile, join(root, 'state'), 'operation')
        const restored = new Database(join(snapshot, 'profile/opencove.db'), { readonly: true })
        try {
          expect(restored.prepare('SELECT value FROM snapshot_probe').get()).toEqual({
            value: 'committed-in-wal',
          })
        } finally {
          restored.close()
        }
      } finally {
        db.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a newer schema without moving or replacing the original database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-runtime-schema-'))
    try {
      const path = join(root, 'opencove.db')
      const db = new Database(path)
      db.pragma('user_version=999')
      db.exec('CREATE TABLE durable_data (id INTEGER)')
      db.close()
      const before = await readFile(path)
      await expect(createPersistenceStore({ dbPath: path, strictRecovery: true })).rejects.toThrow(
        'downgrade',
      )
      expect(await readFile(path)).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes independent lock connections while allowing durable journal updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-runtime-lock-'))
    const first = new ManagedDeploymentStore(root)
    const second = new ManagedDeploymentStore(root)
    try {
      const calls: string[] = []
      let release!: () => void
      const barrier = new Promise<void>(resolve => {
        release = resolve
      })
      const a = first.exclusive(async () => {
        calls.push('first')
        await barrier
      })
      const b = second.exclusive(async () => {
        calls.push('second')
      })
      expect(calls).toEqual(['first'])
      release()
      await Promise.all([a, b])
      expect(calls).toEqual(['first', 'second'])
    } finally {
      first.dispose()
      second.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
