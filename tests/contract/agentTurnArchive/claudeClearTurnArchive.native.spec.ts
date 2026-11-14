// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createSqliteAgentTurnArchive } from '../../../src/contexts/agent/infrastructure/turnArchive/createSqliteAgentTurnArchive'
import { assertClearTurnComposition } from '../../unit/app/claudeClearTurnComposition.helpers'

describeWithElectronNativeModules('Claude clear exact archive identity', () => {
  it('persists A and B before held B4b commitment and reads both through a rebuilt registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencove-clear-archive-'))
    const archive = createSqliteAgentTurnArchive({
      userDataPath: root,
      now: Date.now,
      membership: () => 'member',
    })
    try {
      await assertClearTurnComposition(archive)
    } finally {
      archive.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
