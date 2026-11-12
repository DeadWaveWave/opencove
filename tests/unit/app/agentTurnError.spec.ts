// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { presentAgentTurnError } from '../../../src/app/cli/core/agentTurnError'
import { CliError, printError } from '../../../src/app/cli/core/errors'
import { identityFixture } from './cliIdentity.helpers'

it.skipIf(process.platform === 'win32').each(['t1', `turn O'Brian "two words"`])(
  'round-trips displayed recovery commands for %s',
  turnId => {
    const error = presentAgentTurnError(
      new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, {
        reason: 'turn_not_ended',
      }),
      { nodeId: 'node-123456', sessionId: 's', turnId },
    )
    const io = identityFixture().io
    let displayed = ''
    io.stderr = {
      isTTY: true,
      write: text => {
        displayed += text
      },
    }
    printError(io, error, false)
    const commands = displayed.split('\n').filter(line => line.startsWith('  opencove '))
    expect(commands).toHaveLength(1)
    const argv = execFileSync('sh', ['-c', `set -- ${commands[0].trim()}\nprintf '%s\\0' "$@"`])
      .toString()
      .split('\0')
      .slice(0, -1)
    expect(argv).toEqual(['opencove', 'agent', 'wait', '--node', 'node-123456', '--turn', turnId])
  },
)

it
  .skipIf(process.platform === 'win32')
  .each([
    'turn_not_found',
    'provider_sent_no_message',
    'no_ended_turn',
    'remote_history_unavailable',
  ])('puts every recovery command on a literal argv-only line for %s', reason => {
  const nodeId = `node O'Brian`,
    sessionId = 'session "two words"'
  const hint = presentAgentTurnError(
    new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, { reason }),
    { nodeId, sessionId, turnId: 't1' },
  ).hint!
  const commands = hint.split('\n').filter(line => line.startsWith('  opencove '))
  const actual = commands.map(command =>
    execFileSync('sh', ['-c', `set -- ${command.trim()}\nprintf '%s\\0' "$@"`])
      .toString()
      .split('\0')
      .slice(0, -1),
  )
  const get = ['opencove', 'agent', 'get', '--node', nodeId]
  const screen = ['opencove', 'agent', 'read', '--node', nodeId, '--screen']
  const final = ['opencove', 'session', 'final', '--session', sessionId]
  expect(actual).toEqual(
    reason === 'turn_not_found'
      ? [get]
      : reason === 'provider_sent_no_message'
        ? [screen, final]
        : [get, screen, final],
  )
})
