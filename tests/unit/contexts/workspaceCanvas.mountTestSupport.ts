import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'

export function createMountAwareAgentControlSurface(options: {
  workspaceId: string
  rootPath: string
  launchInMount?: ReturnType<typeof vi.fn>
}) {
  const rootUri = pathToFileURL(options.rootPath).href
  const mountId = 'mount-local'

  return vi.fn(async (request: { id: string; payload: unknown }) => {
    if (request.id === 'mount.list') {
      return {
        projectId: options.workspaceId,
        mounts: [
          {
            mountId,
            projectId: options.workspaceId,
            name: 'Local',
            sortOrder: 0,
            endpointId: 'local',
            targetId: 'target-local',
            rootPath: options.rootPath,
            rootUri,
          },
        ],
      }
    }

    if (request.id === 'session.launchAgentInMount' && options.launchInMount) {
      return await options.launchInMount(request.payload)
    }

    throw new Error(`Unexpected control surface request: ${request.id}`)
  })
}
