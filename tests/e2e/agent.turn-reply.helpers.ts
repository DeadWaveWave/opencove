import { resolveConnection } from '../../src/app/cli/core/context'
import { createNodeCliIo } from '../../src/app/cli/core/io'
import { expect } from '@playwright/test'
import { agentEvents } from '../../src/app/cli/core/agentEvents'
import { agentRunEventSchema } from '../../src/shared/contracts/dto/agentRunStateSchema'
import type { AgentRunEvent } from '../../src/shared/contracts/dto/agentRunState'
import { cli } from './agent.prompt.real-codex.helpers'

export function replyMarker(blocks: string[]): string {
  const text = blocks.join('\n')
  for (const marker of ['REPLY_STEER', 'REPLY_B', 'REPLY_A']) {
    if (text.includes(marker)) {
      return `${marker}: complete 🙂`
    }
  }
  return 'ACK'
}
export async function readExact(
  userDataDir: string,
  nodeId: string,
  turnId: string,
  message: string,
) {
  const waited = await cli(userDataDir, [
    'agent',
    'wait',
    '--node',
    nodeId,
    '--turn',
    turnId,
    '--timeout',
    '30s',
    '-o',
    'json',
  ])
  expect(waited.exitCode, JSON.stringify(waited)).toBe(0)
  expect(JSON.parse(waited.stdout)).toMatchObject({ nodeId, turnId, outcome: 'completed' })
  const read = await cli(userDataDir, [
    'agent',
    'read',
    '--node',
    nodeId,
    '--turn',
    turnId,
    '-o',
    'json',
  ])
  expect(read.exitCode, JSON.stringify(read)).toBe(0)
  expect(JSON.parse(read.stdout)).toMatchObject({
    nodeId,
    turnId,
    message,
    source: 'hook',
    truncated: false,
  })
  return JSON.parse(read.stdout) as { turnId: string; message: string; deliveryIds: string[] }
}

/** Observe the real Worker SSE stream with the same parser and cursor fence as CLI waits. */
export async function captureTurnEvents(userDataDir: string, nodeId: string) {
  const listed = await cli(userDataDir, ['agent', 'list', '-o', 'json'])
  expect(listed.exitCode, JSON.stringify(listed)).toBe(0)
  const baseline = JSON.parse(listed.stdout) as { epoch: string; seq: number }
  const io = createNodeCliIo()
  let connection
  try {
    // An explicit profile and empty connection env prevent default-profile discovery.
    connection = await resolveConnection({ 'user-data': userDataDir }, { ...io, env: {} })
  } finally {
    io.dispose?.()
  }
  const controller = new AbortController()
  const values: AgentRunEvent[] = []
  let ready!: () => void
  const opened = new Promise<void>(resolve => {
    ready = resolve
  })
  const task = (async () => {
    for await (const value of agentEvents({
      connection,
      nodeId,
      epoch: baseline.epoch,
      afterSeq: baseline.seq,
      fetch,
      signal: controller.signal,
      onOpen: async () => {
        ready()
      },
    })) {
      values.push(agentRunEventSchema.parse(value))
    }
  })()
  // Attach a rejection handler immediately and surface failures both on open and cleanup.
  const failed = task.then(() => {
    throw new Error('Agent event stream closed before opening')
  })
  try {
    await Promise.race([
      opened,
      failed,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Agent event stream did not open'))
        }, 10_000)
        opened.finally(() => clearTimeout(timer))
      }),
    ])
  } catch (error) {
    controller.abort()
    await task.catch(() => {})
    throw error
  }
  return {
    values,
    close: async () => {
      controller.abort()
      // Aborting the stream is the expected way to end it; surface any other failure.
      await task.catch(error => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          throw error
        }
      })
    },
  }
}
