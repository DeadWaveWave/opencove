import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  hasToolResult,
  lastUserBlocks,
  launchRealClaude,
  prompt,
  sse,
} from './agent.prompt.real-claude.helpers'

test('a real coordinating Claude resumes child completion observations and reads the exact turn', async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(
    process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1',
    'Requires installed real Claude CLI; local mock Messages API',
  )
  test.skip(process.platform === 'win32', 'POSIX Bash workflow and process signals')
  test.setTimeout(240_000)
  let command = ''
  let executed = 0
  const real = await launchRealClaude(testInfo, 'off', {
    fullAccess: true,
    messages: {
      onMain(res, body) {
        if (
          hasToolResult(body) ||
          !lastUserBlocks(body).some(block => block.includes('RUN_EVENTS_WORKFLOW'))
        ) {
          return false
        }
        executed++
        const usage = { input_tokens: 12, output_tokens: 4 }
        sse(res, [
          {
            type: 'message_start',
            message: {
              id: 'msg_events',
              type: 'message',
              role: 'assistant',
              model: body.model,
              content: [],
              stop_reason: null,
              usage,
            },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_events', name: 'Bash', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify({
                command,
                timeout: 120_000,
                description: 'Observe and resume a child agent completion',
              }),
            },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 4 },
          },
          { type: 'message_stop' },
        ])
        return true
      },
    },
  })
  const artifact = join(real.root, 'event-observations.json')
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  command = `node ${quote(resolve('tests/e2e/cli.events.workflow.cjs'))} ${quote(artifact)}`
  try {
    const result = await prompt(
      real.userDataDir,
      real.nodeId,
      'RUN_EVENTS_WORKFLOW: execute the supplied Bash workflow once.',
    )
    expect(result.exitCode, JSON.stringify(result)).toBe(0)
    // `agent prompt` confirms delivery, not completion: wait for the workflow's own artifact,
    // which it writes only after the child turn ended and the resumed stream was observed.
    await expect
      .poll(
        async () => {
          try {
            JSON.parse(await readFile(artifact, 'utf8'))
            return true
          } catch {
            return false
          }
        },
        { timeout: 120_000, intervals: [250, 500, 1000] },
      )
      .toBe(true)
    expect(executed).toBe(1)
    const evidence = JSON.parse(await readFile(artifact, 'utf8'))
    expect(
      evidence.records.filter((r: { type: string }) => r.type === 'stream.ready'),
    ).toHaveLength(2)
    const ends = evidence.records.filter((r: { type: string }) => r.type === 'agent.turn_completed')
    expect(ends).toHaveLength(1)
    expect(evidence.reply).toMatchObject({
      nodeId: evidence.created.node.id,
      sessionId: evidence.created.node.sessionId,
      turnId: ends[0].endedTurn.id,
      outcome: 'completed',
      message: 'DONE-TEXT',
    })
    expect(evidence.exits).toEqual([143, 0])
    expect(
      evidence.operations.filter((id: string) =>
        ['agent.get', 'agent.list', 'session.presentationSnapshot'].includes(id),
      ),
    ).toEqual([])
    expect(evidence.operations.filter((id: string) => id === 'agent.finalMessage')).toHaveLength(1)
    await testInfo.attach('event-observations', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    })
  } finally {
    await real.close()
  }
})
