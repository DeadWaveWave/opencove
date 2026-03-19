import {
  appendCodexRecord,
  createCodexSessionFile,
  runJsonlStdinSubmitDelayedTurnScenario,
} from '../test-agent-session-jsonl.mjs'
import { sleep } from './sleep.mjs'

export async function runCodexStandbyNoNewlineScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(800)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [],
    },
  })

  await sleep(1200)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: 'All set.',
          },
        ],
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}

export async function runCodexCommentaryThenFinalScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(700)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [],
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [
        {
          type: 'output_text',
          text: 'I am checking the repo before making changes.',
        },
      ],
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'function_call',
      call_id: 'call-cove-test-1',
      name: 'exec_command',
      arguments: '{"cmd":"pwd"}',
    },
  })

  // Leave a larger observation window between commentary/tool-call activity
  // and the final answer so CI timing jitter does not race the status assertion.
  await sleep(4500)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: 'Done.',
          },
        ],
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}

export { runJsonlStdinSubmitDelayedTurnScenario }
