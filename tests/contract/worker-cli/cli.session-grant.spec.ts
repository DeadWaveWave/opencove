/* eslint-disable no-await-in-loop -- Each request observes the preceding mutation or authorization boundary. */
import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'
import type { PersistedAppStateContract } from '../../../src/shared/contracts/persistedAppState'
import { encodeClaudeProjectPath } from '../../../src/contexts/agent/infrastructure/ClaudeProjectPaths'
import { createCommandPlugin } from '../../e2e/plugins.commands.helpers'
import {
  assertGrantLaunchPolicy,
  grantCliCommands,
  assertHumanDecisionDenied,
  assertDeniedGrantApi,
  cli,
  projectId,
  spaceId,
  worktreeSpace,
} from '../../support/cliSessionGrant'
import { terminalCommand } from './terminal'
import {
  providerMessageCommands,
  singleTokenLaunchPrompts,
  providerLaunchCommands,
} from '../../support/sessionGrantCases'
import { withWorker } from './fixture'
import {
  prepareGrantWorker,
  seedGrantWorkspace,
  runtimeFootprint,
  assertLiveProviderGrant,
  assertRevokedProviderGrant,
} from './session-grant.helpers'

test('session grants preserve backend workflows, deny authority changes and revoke on exit', async () => {
  await withWorker(
    async worker => {
      const { root, workspace } = worker
      const record = join(root, 'prompt-record.jsonl'),
        dialog = join(root, 'dialog')
      let pluginDirectory: string | undefined
      try {
        await seedGrantWorkspace(worker)
        const binding = await worker.createTerminal(projectId, 'terminal', spaceId)
        expect(binding.sessionId).toBeTruthy()
        const command = (...args: string[]) =>
          terminalCommand(worker, binding, cli(...args), args.slice(0, 2).join('_'))
        const { success, object } = grantCliCommands(command)
        const invalidPty = await command(
          'pty',
          'attach',
          '--session',
          binding.sessionId,
          '--token',
          'invalid-test-token',
        )
        expect(invalidPty).toMatch(/\bexit=4\b/)
        expect(invalidPty.replaceAll('\n', '')).toContain(
          'The control token is invalid or has been revoked.',
        )
        expect(await object('whoami')).toMatchObject({
          caller: 'session-grant',
          scope: 'interact',
          nodeId: binding.nodeId,
        })
        await object('context')
        await object('node', 'list')
        await object('node', 'get', '--node', '@self')
        await object('space', 'list')
        await object('space', 'get')
        await object('project', 'list')
        await object('mount', 'list')
        await success('skill')
        await success('api', 'schema', 'node.create')
        expect(await object('api', 'schema', 'session.writeNode')).toMatchObject({
          access: 'denied',
          reason: expect.stringContaining(
            'only the user can answer permission prompts and dialogs',
          ),
          policyVersion: expect.any(String),
        })
        await assertGrantLaunchPolicy({
          footprint: () => runtimeFootprint(worker),
          spaceId,
          root,
          command,
          object,
        })
        // Compact content for ConPTY wrapping only after preserving/checking the exit status line.
        const catalog = (
          await success('api', 'ops', '--prefix', 'session', '--limit', '0')
        ).replaceAll('\n', '')
        expect(catalog).toContain('"access":"denied"')
        expect(catalog).toContain('"access":"constrained"')
        await object('api', 'call', 'system.whoami', '--input', '{}')
        for (const [kind, flags] of [
          ['note', ['--text', 'Brief']],
          ['task', ['--requirement', 'Verify grants']],
          ['website', ['--url', 'https://example.com']],
        ] as const) {
          const result = await object('node', 'create', kind, ...flags)
          const nodeId = (result.node as { id: string }).id
          await success('node', 'update', kind, '--node', nodeId, ...flags)
          await success('canvas', 'focus', 'node', '--node', nodeId)
          await success('node', 'delete', '--node', nodeId)
        }
        const file = pathToFileURL(join(workspace, 'grant.txt')).href
        await success('fs', 'write', '--uri', file, '--content', 'Grant IO')
        expect(await success('fs', 'read', '--uri', file)).toContain('Grant IO')
        await success('fs', 'stat', '--uri', file)
        await success('fs', 'ls', '--uri', pathToFileURL(workspace).href)
        await success('worktree', 'list')
        await success('worktree', 'create', '--space', worktreeSpace, '--name', 'grant-check')
        await success('worktree', 'archive', '--space', worktreeSpace, '--force', '--delete-branch')

        // Both nested spawn paths and deletion run under the real terminal grant.
        const child = await object(
          'node',
          'create',
          'terminal',
          '--command',
          "node -e \"setInterval(()=>console.log('VIEWER_'+'STREAM_READY'),100)\"",
        )
        const childNode = child.node as { id: string; sessionId: string }
        const attaching = command('pty', 'attach', '--session', childNode.sessionId)
        await expect.poll(() => worker.snapshot(binding.sessionId)).toContain('VIEWER_STREAM_READY')
        await worker.invoke('session.kill', { sessionId: childNode.sessionId })
        const attached = await attaching
        expect(attached).toContain('VIEWER_STREAM_READY')
        expect(attached).toMatch(/\bexit=[01]\b/)
        expect(attached).not.toContain('common.forbidden')
        await success('node', 'delete', '--node', childNode.id)

        const agent = await object(
          'node',
          'create',
          'agent',
          '--provider',
          'claude-code',
          '--prompt',
          '',
          '--full-access',
          'true',
        )
        const agentNode = agent.node as { id: string; sessionId: string }
        const { state } = await worker.invoke<{
          state: PersistedAppStateContract<{ agentFullAccess: boolean }>
        }>('sync.state', null, 'query')
        const savedAgent = state.workspaces
          .flatMap(project => project.nodes)
          .find(node => node.id === agentNode.id)
        expect({
          setting: state.settings.agentFullAccess,
          explicit:
            savedAgent?.agent && 'agentFullAccess' in savedAgent.agent
              ? savedAgent.agent.agentFullAccess
              : undefined,
        }).toEqual({ setting: false, explicit: true })
        const agentSnapshot = () =>
          worker.invoke<AgentRunSnapshot>('agent.get', { sessionId: agentNode.sessionId }, 'query')
        await expect.poll(() => worker.snapshot(agentNode.sessionId)).toContain('STRICT_READY')
        await worker.invoke('session.writeNode', {
          nodeId: agentNode.id,
          sessionId: agentNode.sessionId,
          data: 'manual baseline\r',
        })
        await expect.poll(() => worker.snapshot(agentNode.sessionId)).toContain('STRICT_TURN_1')
        await expect.poll(async () => (await agentSnapshot()).state).toBe('idle')
        await success('agent', 'list')
        await success('agent', 'get', '--node', agentNode.id)
        await success('agent', 'read', '--node', agentNode.id, '--screen')
        const beforeCommands = await readFile(record, 'utf8')
        for (const text of providerMessageCommands) {
          const denied = await command(
            'agent',
            'prompt',
            '--node',
            agentNode.id,
            '--text',
            text,
            '-o',
            'json',
          )
          expect(denied).toMatch(/\bexit=4\b/)
          expect(denied.replaceAll('\n', '')).toContain('field_denied')
          expect(denied.replaceAll('\n', '')).toContain('provider control')
          expect(denied.replaceAll('\n', '')).toContain('Ask about the control in a sentence')
        }
        expect(await readFile(record, 'utf8')).toBe(beforeCommands)
        const delivery = await object(
          'agent',
          'prompt',
          '--node',
          agentNode.id,
          '--text',
          'Review this project',
        )
        expect(delivery.phase).toBe('submission_observed')
        await success('agent', 'delivery', String(delivery.deliveryId), '--wait')
        await success('agent', 'wait', '--node', agentNode.id, '--turn', String(delivery.turnId))
        expect(
          (
            await success(
              'agent',
              'read',
              '--node',
              agentNode.id,
              '--turn',
              String(delivery.turnId),
              '-o',
              'json',
            )
          ).replaceAll('\n', ''),
        ).toContain('Strict reply 2')
        await success('agent', 'history', 'clear', '--node', agentNode.id)
        await writeFile(dialog, 'permission')
        // The hook publishes waiting before the stub appends its dialog-entry record.
        // Include that record in the baseline so only unexpected input changes it.
        await expect.poll(() => readFile(record, 'utf8')).toContain('{"kind":"dialog","bytes":0}\n')
        await expect.poll(async () => (await agentSnapshot()).state).toBe('waiting')
        const before = await readFile(record, 'utf8')
        await assertHumanDecisionDenied({ command, root, agentNode })
        for (const [id, input] of [
          ['sync.writeState', { state: {} }],
          ['sync.state', {}],
          ['session.launchAgent', { spaceId, prompt: 'Start a review' }],
        ] as const) {
          await assertDeniedGrantApi({ command, root, id, input })
        }
        const launchFootprint = () => runtimeFootprint(worker)
        const beforeLaunches = await launchFootprint()
        for (const prompt of singleTokenLaunchPrompts) {
          const denied = await command(
            'node',
            'create',
            'agent',
            '--provider',
            'codex',
            '--prompt',
            prompt,
            '-o',
            'json',
          )
          expect(denied).toMatch(/\bexit=4\b/)
          const error = denied.replaceAll('\n', '')
          expect(error).toContain('common.forbidden')
          expect(error).toContain('field_denied')
          expect(error).toContain('single token')
          expect(error).toContain('Rephrase the task as a sentence')
          expect(await launchFootprint()).toEqual(beforeLaunches)
        }
        for (const prompt of providerLaunchCommands) {
          const denied = await command(
            'node',
            'create',
            'agent',
            '--provider',
            'claude-code',
            '--prompt',
            prompt,
            '-o',
            'json',
          )
          expect(denied).toMatch(/\bexit=4\b/)
          const error = denied.replaceAll('\n', '')
          expect(error).toContain('common.forbidden')
          expect(error).toContain('field_denied')
          expect(error).toContain('provider_command_prefix')
          expect(error).toContain('provider control')
          expect(error).toContain('Ask about the control in a sentence')
          expect(await launchFootprint()).toEqual(beforeLaunches)
        }
        const nestedRefusal = await command(
          'node',
          'create',
          'agent',
          '--provider',
          'pi',
          '--prompt',
          'update',
        )
        expect(nestedRefusal).toMatch(/\bexit=4\b/)
        expect(nestedRefusal.replaceAll('\n', '')).toContain('single token')
        expect(nestedRefusal.replaceAll('\n', '')).toContain('Rephrase the task as a sentence')
        expect(await launchFootprint()).toEqual(beforeLaunches)
        const plugin = await createCommandPlugin('single')
        pluginDirectory = plugin.directory
        await worker.invoke('plugin.install', { directory: plugin.directory })
        const pluginDenied = await command('plugin', 'run', plugin.id, 'inspect')
        expect(pluginDenied).toMatch(/\bexit=4\b/)
        expect(pluginDenied.replaceAll('\n', '')).toContain('plugin authority')
        expect(await readFile(record, 'utf8')).toBe(before)
        const capturedGrant = await assertLiveProviderGrant(
          worker,
          agentNode.id,
          agentNode.sessionId,
        )
        await success('node', 'delete', '--node', agentNode.id)
        await expect
          .poll(
            async () =>
              (
                await worker.invoke<{ sessions: { sessionId: string; status: string }[] }>(
                  'session.list',
                  null,
                  'query',
                )
              ).sessions.find(session => session.sessionId === agentNode.sessionId)?.status,
          )
          .toBe('exited')
        await assertRevokedProviderGrant(worker, capturedGrant)

        const refusedStandalone = await command(
          'session',
          'run-agent',
          '--provider',
          'claude-code',
          '--prompt',
          'Start a review',
        )
        expect(refusedStandalone).toMatch(/\bexit=4\b/)
        expect(refusedStandalone.replaceAll('\n', '')).toContain('node create')
        const session = await worker.invoke<{ sessionId: string; resumeSessionId: string | null }>(
          'session.launchAgent',
          { spaceId, provider: 'claude-code', prompt: 'Start a review' },
        )
        const sessionId = String(session.sessionId)
        await success('session', 'get', '--session', sessionId)
        // The strict fixture has no provider transcript; final must report truthful unavailability.
        const final = await command('session', 'final', '--session', sessionId)
        expect(final).toMatch(/\bexit=1\b/)
        expect(final.replaceAll('\n', '')).toContain('session.transcript_not_ready')
        // Seed only the isolated provider transcript, then exercise the real final-message reader.
        expect(typeof session.resumeSessionId).toBe('string')
        const sessionDetails = await object('session', 'get', '--session', sessionId)
        const transcriptDirectory = join(
          root,
          'claude',
          'projects',
          encodeClaudeProjectPath(String(sessionDetails.cwd)),
        )
        await mkdir(transcriptDirectory, { recursive: true })
        await writeFile(
          join(transcriptDirectory, `${session.resumeSessionId}.jsonl`),
          JSON.stringify({
            type: 'assistant',
            message: {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: 'Grant transcript reply' }],
            },
          }) + '\n',
        )
        expect(await object('session', 'final', '--session', sessionId)).toMatchObject({
          message: 'Grant transcript reply',
        })
        await success('session', 'kill', '--session', sessionId)
      } finally {
        if (pluginDirectory) {
          await rm(pluginDirectory, { recursive: true, force: true })
        }
      }
    },
    { agentSessionScenario: 'claude-prompt-strict', prepare: prepareGrantWorker },
  )
})
