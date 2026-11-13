import type { SeedWorkspace } from '../../e2e/workspace-canvas.helpers'
import { withWorker, type WorkerFixture, type Binding } from './fixture'
export { spaceComparisonCommand, projectId, spaceId } from '../../e2e/cli.output.helpers'
import { projectId, spaceId } from '../../e2e/cli.output.helpers'

export async function createOutputTerminal(
  worker: WorkerFixture,
  kind: 'terminal' | 'agent' = 'terminal',
) {
  return worker.createTerminal(projectId, kind, spaceId)
}

export async function withOutputWorkspace(
  nodes: SeedWorkspace['nodes'],
  execute: (worker: WorkerFixture, shell: Binding) => Promise<void>,
) {
  await withWorker(async worker => {
    await worker.seed(projectId, nodes, [
      {
        id: spaceId,
        name: 'Main',
        directoryPath: worker.workspace,
        nodeIds: nodes.map(n => n.id),
        rect: { x: 0, y: 0, width: 8000, height: 8000 },
      },
    ])
    await execute(worker, await createOutputTerminal(worker))
  })
}
