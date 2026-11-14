/* eslint-disable no-await-in-loop -- Build each generation from its admitted parent. */
import { expect } from '@playwright/test'
import type { CanvasNodeDetailDto } from '../../src/shared/contracts/dto/nodeControl'

export const projectId = 'bounded-project'
export const runtimeKinds = ['agent', 'terminal'] as const
// Four agents and two terminals share a tree, including a nested terminal and depth three.
export const mixedDescendants = [
  { parent: null, kind: 'agent' },
  { parent: 0, kind: 'agent' },
  { parent: 0, kind: 'terminal' },
  { parent: null, kind: 'terminal' },
  { parent: null, kind: 'agent' },
  { parent: null, kind: 'agent' },
] as const
export const recoveredDescendants = [
  'agent',
  'terminal',
  'terminal',
  'terminal',
  'terminal',
  'terminal',
] as const

export async function fillMixedTree(
  f: {
    parent: { id: string }
    child: (caller: { id: string }, kind: 'agent' | 'terminal') => Promise<CanvasNodeDetailDto>
  },
  nodes: CanvasNodeDetailDto[] = [],
) {
  for (const entry of mixedDescendants.slice(nodes.length)) {
    nodes.push(await f.child(entry.parent === null ? f.parent : nodes[entry.parent], entry.kind))
  }
  return nodes
}

export function expectSpawnRefusal(
  result: { code: number; stderr: string },
  code: string,
  exit: number,
) {
  expect(result.code, result.stderr).toBe(exit)
  const error = JSON.parse(result.stderr.trim().split('\n').at(-1)!).error
  expect(error).toMatchObject({
    code,
    retryable: false,
    message: expect.any(String),
    hint: expect.any(String),
  })
  return error
}
