import { encodeEventCursor } from '../../../src/shared/contracts/dto/eventStream'
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
    'system.capabilities': {
      features: {
        nodeLineageV1: true,
        boundedAgentSpawningV1: true,
        eventStreamV1: true,
        nodeNearPlacementV1: true,
      },
    },
    'system.whoami': inside ? who : { kind: 'bearer', scopeTier: 'admin' },
    'project.list': { projects: [project] },
    'space.create': {
      projectId: project.id,
      spaceId: space.id,
      mountId: 'mount',
      space: { ...space, rect: { x: 0, y: 0, width: 420, height: 300 } },
    },
    'space.list': { projectId: project.id, spaces: [space] },
    'space.get': { projectId: project.id, space },
    'node.list': { nodes: [node] },
    'agent.list': { agents: [] },
    'system.operation.describe': {
      inputSchema: { anyOf: [{ properties: { agentOnly: { const: true } } }] },
    },
    'node.get': { node },
    'node.create': { node: { ...node, frame: { x: 0, y: 0, width: 220, height: 260 } } },
  }
  const requests: { id: string; payload: Record<string, unknown> }[] = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (new URL(String(_url)).pathname === '/events') {
      const selection = JSON.parse(new URL(String(_url)).searchParams.get('selection')!)
      const cursor = (seq: number) => encodeEventCursor({ version: 1, epoch: 'e', seq, selection })
      const records = [
        { version: 1, type: 'stream.ready', cursor: cursor(1), selection, mode: 'live' },
        {
          version: 1,
          type: 'agent.state_changed',
          cursor: cursor(2),
          epoch: 'e',
          seq: 2,
          projectId: project.id,
          spaceId: space.id,
          snapshot: values['agent.get'],
          spawnedBy: null,
          lineageDepth: 1,
          lineageStatus: 'root',
        },
      ]
      return new Response(records.map(record => `data: ${JSON.stringify(record)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
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
