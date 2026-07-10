// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createSqliteTerminalRecoveryRepository } from '../../../src/contexts/terminal/infrastructure/recovery/createSqliteTerminalRecoveryRepository'
import type {
  TerminalBufferKind,
  TerminalRuntimeBinding,
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { describeWithElectronNativeModules } from '../electronNativeSuite'

function createState(rootPath: string) {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    settings: {},
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: rootPath,
        worktreesRoot: rootPath,
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        activeSpaceId: 'space-1',
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: rootPath,
            nodeIds: ['node-1'],
            rect: null,
          },
        ],
        nodes: [
          {
            id: 'node-1',
            sessionId: null,
            title: 'Shell',
            position: { x: 0, y: 0 },
            width: 520,
            height: 360,
            kind: 'terminal',
            profileId: null,
            runtimeKind: 'posix',
            terminalGeometry: { cols: 40, rows: 4 },
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            executionDirectory: rootPath,
            expectedDirectory: rootPath,
            agent: null,
            task: null,
          },
        ],
      },
    ],
  }
}

function binding(generation: number): TerminalRuntimeBinding {
  return {
    sessionId: `session-${generation}`,
    runtimeEpoch: `epoch-${generation}`,
    route: { kind: 'local', workerInstanceId: `worker-${generation}` },
  }
}

describeWithElectronNativeModules('SQLite terminal recovery across runtime epochs', () => {
  it('reopens three generations with archived history plus only the latest live checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opencove-terminal-epochs-'))
    const dbPath = join(directory, 'opencove.db')
    try {
      const initialStore = await createPersistenceStore({ dbPath })
      const initialWrite = await initialStore.writeAppState(createState(directory))
      expect(initialWrite.ok).toBe(true)
      initialStore.dispose()

      const commitEpoch = async (
        generation: number,
        serializedScreen: string,
        bufferKind: TerminalBufferKind,
      ): Promise<void> => {
        const repository = await createSqliteTerminalRecoveryRepository({ dbPath })
        const epochBinding = binding(generation)
        await expect(
          repository.reserve({
            nodeId: 'node-1',
            generation,
            now: `2026-07-10T00:0${generation}:00.000Z`,
          }),
        ).resolves.toMatchObject({ ok: true })
        await expect(
          repository.bind({
            nodeId: 'node-1',
            generation,
            binding: epochBinding,
            now: `2026-07-10T00:0${generation}:01.000Z`,
          }),
        ).resolves.toMatchObject({ ok: true })
        await expect(
          repository.commit({
            nodeId: 'node-1',
            generation,
            binding: epochBinding,
            checkpoint: {
              checkpointRevision: 1,
              appliedSeq: 1,
              presentationRevision: 1,
              cols: 40,
              rows: 4,
              geometryRevision: null,
              bufferKind,
              cursor: { x: 0, y: 0 },
              title: 'shell',
              serializedScreen,
            },
            rawTail: serializedScreen,
            rawTruncated: false,
            checksum: null,
            now: `2026-07-10T00:0${generation}:02.000Z`,
          }),
        ).resolves.toMatchObject({ ok: true })
        repository.dispose()
      }

      await commitEpoch(1, 'FIRST_EPOCH_PROMPT', 'normal')
      await commitEpoch(2, '\u001b[?1049h\u001b[HSECOND_EPOCH_TUI', 'alternate')
      await commitEpoch(3, 'THIRD_EPOCH_SHELL', 'normal')

      const reopenedStore = await createPersistenceStore({ dbPath })
      const recovered = await reopenedStore.readNodeScrollback('node-1')
      reopenedStore.dispose()
      const recoveredScrollback = recovered ?? ''
      expect(recoveredScrollback).toContain('FIRST_EPOCH_PROMPT')
      expect(recoveredScrollback).toContain('SECOND_EPOCH_TUI')
      expect(recoveredScrollback).toContain('THIRD_EPOCH_SHELL')
      expect(recoveredScrollback.indexOf('FIRST_EPOCH_PROMPT')).toBeLessThan(
        recoveredScrollback.indexOf('SECOND_EPOCH_TUI'),
      )
      expect(recoveredScrollback.indexOf('SECOND_EPOCH_TUI')).toBeLessThan(
        recoveredScrollback.indexOf('THIRD_EPOCH_SHELL'),
      )

      const db = new Database(dbPath, { readonly: true })
      try {
        const row = db
          .prepare(
            'SELECT checkpoint_revision, presentation_json FROM terminal_recovery_records WHERE node_id = ?',
          )
          .get('node-1') as { checkpoint_revision: number; presentation_json: string } | undefined
        const envelope = JSON.parse(row?.presentation_json ?? 'null') as {
          archivedEpochs?: Array<{ runtimeEpoch?: string; serializedScreen?: string }>
          serializedScreen?: string
        } | null
        expect(row?.checkpoint_revision).toBe(1)
        expect(envelope?.archivedEpochs).toMatchObject([
          { runtimeEpoch: 'epoch-1', serializedScreen: 'FIRST_EPOCH_PROMPT' },
          { runtimeEpoch: 'epoch-2' },
        ])
        expect(envelope?.serializedScreen).toBe('THIRD_EPOCH_SHELL')
      } finally {
        db.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
