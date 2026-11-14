import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shellWord } from '../../../src/app/cli/core/shellWord'
import { createAgentWaitArgs } from '../../support/cliNodeCreateAgentWait'
import { initialAgentWaitStub } from '../../support/initialAgentWaitStub'
import { withWorker } from './fixture'
import { jsonOutput, terminalCommand } from './terminal'

for (const scenario of [
  { provider: 'claude-code', dialog: null },
  { provider: 'codex', dialog: null },
  { provider: 'claude-code', dialog: 'permission' },
  { provider: 'claude-code', dialog: 'question' },
]) {
  test(`create agent waits for ${scenario.provider} initial ${scenario.dialog ?? 'reply'} through the CLI`, async () => {
    test.skip(
      scenario.provider === 'codex' && process.platform === 'win32',
      'Codex lifecycle hooks require POSIX',
    )
    test.setTimeout(90_000)
    await withWorker(
      async worker => {
        await worker.seed('create-wait-project', [], [], {
          agentFullAccess: false,
          codexReuseRunningAppServer: false,
        })
        const binding = await worker.createTerminal('create-wait-project')
        expect(binding.sessionId).toBeTruthy()
        const output = await terminalCommand(
          worker,
          binding,
          [
            'opencove',
            ...createAgentWaitArgs(
              scenario.provider,
              scenario.dialog === 'permission'
                ? 'Permission check'
                : scenario.dialog === 'question'
                  ? 'Question check'
                  : 'Initial reply',
            ),
          ]
            .map(shellWord)
            .join(' '),
          'CREATE_WAIT',
        )
        const compact = output.replaceAll('\n', '')
        if (scenario.dialog) {
          expect(compact).toMatch(/\bexit=10\b/)
          const start = compact.indexOf('{'),
            end = compact.lastIndexOf('}')
          const error = JSON.parse(compact.slice(start, end + 1)).error
          expect(error).toMatchObject({
            code: 'agent.wait_attention',
            retryable: false,
            details: {
              nodeId: expect.any(String),
              sessionId: expect.any(String),
              turnId: expect.any(String),
              targets: [
                {
                  blockedReason: scenario.dialog,
                  blockedSummary:
                    scenario.dialog === 'permission'
                      ? null
                      : {
                          kind: 'question',
                          questions: [{ question: 'Allow access?', options: ['Allow', 'Deny'] }],
                        },
                },
              ],
            },
          })
          expect(error.hint).toContain(
            `agent wait --node ${error.details.nodeId} --turn ${error.details.turnId}`,
          )
        } else {
          const result = jsonOutput(output)
          expect(result).toMatchObject({
            node: {
              id: expect.any(String),
              sessionId: expect.any(String),
              spawnedBy: binding.nodeId,
            },
            outcome: 'completed',
            turnId: expect.any(String),
            reply: { message: 'Initial stub reply', source: 'hook' },
          })
          const node = result.node as { id: string; sessionId: string }
          expect(result.reply).toMatchObject({
            nodeId: node.id,
            sessionId: node.sessionId,
            turnId: result.turnId,
          })
        }
        const agents = await worker.invoke<{ nodes: unknown[] }>(
          'node.list',
          { projectId: 'create-wait-project', kind: 'agent' },
          'query',
        )
        expect(agents.nodes).toHaveLength(1)
      },
      {
        agentSessionScenario: 'claude-prompt-strict',
        prepare: async root => {
          const script = join(root, 'initial-agent.mjs')
          await writeFile(script, initialAgentWaitStub)
          return { OPENCOVE_TEST_AGENT_STUB_SCRIPT: script }
        },
      },
    )
  })
}
