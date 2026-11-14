// @vitest-environment node
import fs from 'node:fs/promises'
import { afterEach, it } from 'vitest'
import { claudeTranscriptAccess } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import { disposeFixtures, fixture } from './claudeTranscriptAccess.helpers'

afterEach(disposeFixtures)
it.skipIf(process.platform !== 'darwin')(
  'the canonical /private spelling of an authorized /var root is equivalent',
  async () => {
    const f = await fixture(),
      canonical = await fs.realpath(f.path)
    const alias = f.config.replace(/^\/private\/var\//, '/var/')
    const handle = await claudeTranscriptAccess(canonical, 'provider', [alias]).open()
    await handle.close()
  },
)
