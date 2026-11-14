import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import {
  createLineageAgent,
  establishLineageAgentReady,
  grantedAgentCli,
} from './cli.agent-lineage.helpers'
import {
  taskNotesApp,
  projectId,
  noteId,
  getNode,
  persistedNodes,
  focusNode,
  successfulJson,
} from './cli.task-notes.helpers'

test('inline, file, stdin and concurrent granted appends reach the canvas and survive restart', async () => {
  test.setTimeout(180_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-note-append-'))
  let app: ElectronApplication | undefined
  try {
    const launched = await taskNotesApp(root)
    app = launched.electronApp
    let page = launched.window
    const a = (await createLineageAgent(page, projectId)).node
    const b = (await createLineageAgent(page, projectId)).node
    await establishLineageAgentReady(page, a)
    await establishLineageAgentReady(page, b)
    const inline = ' inline ',
      file = '文件\n',
      stdin = '\nstdin '
    const path = join(root, 'result.txt')
    await writeFile(path, file)
    const args = ['note', 'append', '--node', noteId]
    successfulJson(await grantedAgentCli(root, a.id, [...args, '--text', inline]))
    successfulJson(await grantedAgentCli(root, a.id, [...args, '--text-file', path]))
    successfulJson(await grantedAgentCli(root, a.id, [...args, '--text-file', '-'], stdin))
    // Different providers own different request/result files; never overlap requests in one helper mailbox.
    const race = await Promise.all([
      grantedAgentCli(root, a.id, [...args, '--text', 'caller-a']),
      grantedAgentCli(root, b.id, [...args, '--text', 'caller-b']),
    ])
    race.forEach(successfulJson)
    const prefix = [inline, file, stdin].join('\n\n')
    const detail = (await getNode(page, noteId)).node
    expect(detail.data.kind).toBe('note')
    if (detail.data.kind !== 'note') {
      throw new Error('Expected note detail')
    }
    const expected = detail.data.text
    expect([prefix + '\n\ncaller-a\n\ncaller-b', prefix + '\n\ncaller-b\n\ncaller-a']).toContain(
      expected,
    )
    expect((await persistedNodes(page)).find(n => n.id === noteId)?.task).toMatchObject({
      text: expected,
    })
    await focusNode(page, noteId)
    await expect(
      page.locator(`[data-id="${noteId}"]`).getByTestId('note-node-textarea'),
    ).toHaveValue(expected)
    await test.info().attach('appended-note', {
      body: await page.locator(`[data-id="${noteId}"]`).screenshot(),
      contentType: 'image/png',
    })
    await app.close()
    app = undefined
    const restarted = await launchApp(launched.options)
    app = restarted.electronApp
    page = restarted.window
    await focusNode(page, noteId)
    await expect(
      page.locator(`[data-id="${noteId}"]`).getByTestId('note-node-textarea'),
    ).toHaveValue(expected)
    expect((await persistedNodes(page)).find(n => n.id === noteId)?.task).toMatchObject({
      text: expected,
    })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
