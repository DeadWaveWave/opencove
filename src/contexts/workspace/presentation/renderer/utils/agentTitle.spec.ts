import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'
import {
  buildAgentNodeTitle,
  findLinkedTaskTitleForAgent,
  resolveAgentDisplayLabel,
  resolveAgentDisplayTitle,
  stripAgentProviderPrefix,
} from './agentTitle'

function createNode(
  id: string,
  data: Partial<TerminalNodeData> & Pick<TerminalNodeData, 'kind' | 'title'>,
): Node<TerminalNodeData> {
  const { kind, title, ...restData } = data

  return {
    id,
    type: 'default',
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    measured: { width: 320, height: 240 },
    selected: false,
    dragging: false,
    deletable: true,
    data: {
      sessionId: `${id}-session`,
      title,
      width: 320,
      height: 240,
      kind,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: null,
      expectedDirectory: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
      ...restData,
    },
  }
}

describe('agentTitle', () => {
  it('builds provider-prefixed agent titles', () => {
    expect(buildAgentNodeTitle('codex', 'Ship the sidebar refresh')).toBe(
      'codex · Ship the sidebar refresh',
    )
    expect(buildAgentNodeTitle('claude-code', 'claude-sonnet-4-5')).toBe(
      'claude · claude-sonnet-4-5',
    )
  })

  it('prefers linked task titles for display labels', () => {
    expect(
      resolveAgentDisplayTitle({
        provider: 'codex',
        linkedTaskTitle: 'Implement OAuth refresh flow',
        fallbackTitle: 'codex · gpt-5.2-codex',
      }),
    ).toBe('codex · Implement OAuth refresh flow')
  })

  it('falls back to the stored title when no linked task exists', () => {
    expect(
      resolveAgentDisplayTitle({
        provider: 'gemini',
        linkedTaskTitle: null,
        fallbackTitle: 'gemini · gemini-2.5-pro',
      }),
    ).toBe('gemini · gemini-2.5-pro')
  })

  it('prefers the stored title when the node title was pinned by the user', () => {
    expect(
      resolveAgentDisplayTitle({
        provider: 'codex',
        linkedTaskTitle: 'Implement OAuth refresh flow',
        fallbackTitle: 'codex · custom summary',
        preferFallbackTitle: true,
      }),
    ).toBe('codex · custom summary')
  })

  it('strips the provider prefix for sidebar labels', () => {
    expect(stripAgentProviderPrefix('codex', 'codex · custom summary')).toBe('custom summary')
    expect(stripAgentProviderPrefix('claude-code', 'claude')).toBe('claude')
  })

  it.each([
    ['codex', 'Codex · My API review'],
    ['claude-code', 'Claude · My API review'],
    ['claude-code', 'Claude Code · My API review'],
    ['claude-code', 'claude-code · My API review'],
    ['opencode', 'OpenCode · My API review'],
    ['gemini', 'Gemini CLI · My API review'],
    ['pi', 'Pi · My API review'],
    ['kimi', 'Kimi Code · My API review'],
  ] as const)('removes only the known %s decoration from %s', (provider, title) => {
    expect(stripAgentProviderPrefix(provider, title)).toBe('My API review')
    expect(
      resolveAgentDisplayLabel({
        provider,
        linkedTaskTitle: 'A stale linked task',
        fallbackTitle: title,
        preferFallbackTitle: true,
      }),
    ).toBe('My API review')
  })

  it('keeps unknown prefixes, names without the delimiter and provider names inside user text', () => {
    for (const title of ['Claude · Other provider', 'Codex review', 'Review Codex · API']) {
      expect(stripAgentProviderPrefix('codex', title)).toBe(title)
    }
    expect(
      resolveAgentDisplayLabel({
        provider: 'codex',
        linkedTaskTitle: 'Codex · migration checklist',
        fallbackTitle: 'codex · model',
      }),
    ).toBe('Codex · migration checklist')
    expect(stripAgentProviderPrefix('codex', 'codex · Codex · 示例会话')).toBe('示例会话')
    expect(stripAgentProviderPrefix('codex', 'codex · Claude · Codex · API')).toBe(
      'Claude · Codex · API',
    )
  })

  it('prefers linked task text but keeps custom label text when pinned', () => {
    expect(
      resolveAgentDisplayLabel({
        provider: 'codex',
        linkedTaskTitle: 'Implement OAuth refresh flow',
        fallbackTitle: 'codex · gpt-5.2-codex',
      }),
    ).toBe('Implement OAuth refresh flow')

    expect(
      resolveAgentDisplayLabel({
        provider: 'codex',
        linkedTaskTitle: 'Implement OAuth refresh flow',
        fallbackTitle: 'codex · custom summary',
        preferFallbackTitle: true,
      }),
    ).toBe('custom summary')
  })

  it('finds linked task titles by explicit task id or reverse link', () => {
    const nodes = [
      createNode('task-explicit', {
        kind: 'task',
        title: 'Explicit task title',
        task: {
          requirement: 'Do the thing',
          status: 'doing',
          priority: 'medium',
          tags: [],
          linkedAgentNodeId: null,
          agentSessions: [],
          lastRunAt: null,
          autoGeneratedTitle: false,
          createdAt: null,
          updatedAt: null,
        },
      }),
      createNode('task-reverse', {
        kind: 'task',
        title: 'Reverse linked title',
        task: {
          requirement: 'Do the other thing',
          status: 'doing',
          priority: 'medium',
          tags: [],
          linkedAgentNodeId: 'agent-b',
          agentSessions: [],
          lastRunAt: null,
          autoGeneratedTitle: false,
          createdAt: null,
          updatedAt: null,
        },
      }),
    ]

    expect(findLinkedTaskTitleForAgent(nodes, 'agent-a', 'task-explicit')).toBe(
      'Explicit task title',
    )
    expect(findLinkedTaskTitleForAgent(nodes, 'agent-b', null)).toBe('Reverse linked title')
    expect(findLinkedTaskTitleForAgent(nodes, 'agent-c', null)).toBeNull()
  })
})
