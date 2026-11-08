import { vi } from 'vitest'
import type { CliIo } from '../../../src/app/cli/core/io'
export const who = {
  kind: 'session-grant',
  scopeTier: 'interact',
  projectId: 'project-123456',
  spaceId: 'space-123456',
  nodeId: 'node-123456',
  sessionId: 'session-123456',
}
export const project = {
  id: who.projectId,
  name: 'Project',
  path: '/repo',
  activeSpaceId: who.spaceId,
}
export const space = { id: who.spaceId, name: 'Main', directoryPath: '/repo', nodes: [] }
export const node = {
  id: who.nodeId,
  projectId: who.projectId,
  spaceId: who.spaceId,
  kind: 'terminal',
  title: 'Shell',
  status: 'running',
}
export function identityFixture(inside = true) {
  let out = '',
    err = ''
  const values: Record<string, unknown> = {
    'system.whoami': inside ? who : { kind: 'bearer', scopeTier: 'admin' },
    'project.list': { projects: [project] },
    'space.list': { projectId: project.id, spaces: [space] },
    'space.get': { projectId: project.id, space },
    'node.list': { nodes: [node] },
    'agent.list': { agents: [] },
    'node.get': { node },
    'node.create': { node: { ...node, frame: { x: 0, y: 0, width: 220, height: 260 } } },
  }
  const requests: { id: string; payload: Record<string, unknown> }[] = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body))
    requests.push(request)
    return new Response(
      JSON.stringify({
        ok: true,
        value: Object.hasOwn(values, request.id) ? values[request.id] : {},
      }),
    )
  })
  const io: CliIo = {
    stdout: {
      write: s => {
        out += s
      },
    },
    stderr: {
      write: s => {
        err += s
      },
    },
    fetch,
    now: Date.now,
    readStdinText: vi.fn(),
    readTextFile: vi.fn(),
    env: {
      OPENCOVE_CONTROL_URL: 'http://fixture',
      OPENCOVE_CONTROL_TOKEN: 'secret',
      ...(inside
        ? {
            OPENCOVE_ENV: '1',
            OPENCOVE_NODE_ID: who.nodeId,
            OPENCOVE_SPACE_ID: who.spaceId,
            OPENCOVE_PROJECT_ID: who.projectId,
          }
        : {}),
    },
  }
  return {
    io,
    values,
    fetch,
    requests,
    out: () => out,
    error: () => JSON.parse(err.trim().split('\n').at(-1)!).error,
  }
}
