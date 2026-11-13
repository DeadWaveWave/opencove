import { expect, test } from '@playwright/test'
import { jsonOutput, terminalCommand } from './terminal'
import { withOutputWorkspace, spaceComparisonCommand } from './cli.output.helpers'

test('real Worker lists cap display without hiding context neighbors or selector targets', async () => {
  test.setTimeout(180_000)
  const notes = Array.from({ length: 119 }, (_, i) => ({
    id: `cli-output-note-${i}`,
    kind: 'note' as const,
    title: `Note ${i}`,
    position: { x: 100 + (i % 10) * 400, y: 900 + Math.floor(i / 10) * 300 },
    width: 280,
    height: 180,
    task: { text: `Brief ${i}` },
  }))
  await withOutputWorkspace(notes, async (worker, shell) => {
    const capped = await terminalCommand(
      worker,
      shell,
      'opencove node list --fields id',
      'NODE_CAP',
    )
    expect(capped.match(/70 omitted/g)).toHaveLength(1)
    expect(capped).toContain('--full')
    const value = jsonOutput(capped)
    expect(value).toMatchObject({ truncated: true, total: 120 })
    expect(value.nodes).toHaveLength(50)
    const full = jsonOutput(
      await terminalCommand(worker, shell, 'opencove node list --full --fields id', 'NODE_FULL'),
    )
    expect(full.nodes).toHaveLength(120)
    expect(full).not.toHaveProperty('truncated')
    expect(value.nodes).toEqual((full.nodes as unknown[]).slice(0, 50))
    const limited = jsonOutput(
      await terminalCommand(
        worker,
        shell,
        'opencove node list --limit 2 --fields id',
        'NODE_LIMIT',
      ),
    )
    expect(limited).toMatchObject({ truncated: true, total: 120 })
    expect(limited.nodes).toHaveLength(2)
    const table = await terminalCommand(
      worker,
      shell,
      'opencove node list -o table --fields id',
      'NODE_TABLE',
    )
    expect(table.match(/70 omitted/g)).toHaveLength(1)
    expect(table).toContain('exit=0')
    expect(
      table
        .split('\n')
        .filter(line => line.trim().startsWith('cli-output-note-') || line.trim() === shell.nodeId),
    ).toHaveLength(50)
    // Select a node actually omitted from the capped result, without assuming Worker sort order.
    const visibleIds = new Set((value.nodes as { id: string }[]).map(n => n.id))
    const omitted = notes.find(n => !visibleIds.has(n.id))!
    const selected = jsonOutput(
      await terminalCommand(
        worker,
        shell,
        `opencove node get --node "${omitted.title}" --fields id`,
        'NODE_SELECT',
      ),
    )
    expect(selected).toEqual({ node: { id: omitted.id } })
    const context = jsonOutput(
      await terminalCommand(worker, shell, 'opencove context --fields nodes.id', 'CONTEXT_FULL'),
    )
    expect(context.nodes).toHaveLength(119)
    const limitedContext = jsonOutput(
      await terminalCommand(page, shell, 'opencove context --limit 1', 'CONTEXT_LIMIT'),
    )
    expect(limitedContext.nodes).toHaveLength(1)
    expect(limitedContext.next).toHaveLength(1)
    expect(limitedContext.truncated).toMatchObject({ nodes: 119, next: 4 })
    const listedSpaces = jsonOutput(
      await terminalCommand(
        worker,
        shell,
        'opencove space list --fields id,name,directoryPath,boundary,nodeIds,nodeCount,projectId,nodes',
        'SPACES',
      ),
    )
    const gotSpace = jsonOutput(
      await terminalCommand(worker, shell, spaceComparisonCommand, 'SPACE'),
    )
    expect((listedSpaces.spaces as unknown[])[0]).toEqual(gotSpace.space)
  })
})
