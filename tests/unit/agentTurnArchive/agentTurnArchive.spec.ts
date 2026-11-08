// @vitest-environment node
import { describe } from 'vitest'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { agentTurnArchiveContract } from '../../support/agentTurnArchive/agentTurnArchiveContract'

describe('ended-turn archive in memory', () => {
  agentTurnArchiveContract(({ now }) => new InMemoryAgentTurnArchive({ now }))
})
