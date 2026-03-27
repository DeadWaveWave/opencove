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
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'opencove-test-turn-1',
      model_context_window: 128_000,
      collaboration_mode_kind: 'default',
    },
  })

  await sleep(1200)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-turn-1',
        last_agent_message: 'All set.',
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}

export async function runCodexStandbyOnlyScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(1200)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-turn-1',
        last_agent_message: 'All set.',
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
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'opencove-test-turn-1',
      model_context_window: 128_000,
      collaboration_mode_kind: 'default',
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'agent_reasoning',
      text: 'I am checking the repo before making changes.',
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'function_call',
      call_id: 'call-opencove-test-1',
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
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-turn-1',
        last_agent_message: 'Done.',
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}

export { runJsonlStdinSubmitDelayedTurnScenario }
