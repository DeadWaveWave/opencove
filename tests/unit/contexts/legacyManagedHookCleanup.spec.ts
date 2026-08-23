import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
  LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION,
  cleanLegacyClaudeSettings,
  cleanLegacyCodexConfigToml,
  cleanLegacyCodexHooksFile,
  isLegacyOpenCoveCodexHooksFile,
} from '../../../src/contexts/agent/infrastructure/legacyManagedHookCleanup'

function fixture(name: string): string {
  return readFileSync(resolve('tests/fixtures/agent/legacy-managed-hooks', name), 'utf8')
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object')
  expect(value).not.toBeNull()
  return value as Record<string, unknown>
}

function eventGroups(value: unknown, eventName: string): unknown[] {
  const hooks = asRecord(asRecord(value).hooks)
  const groups = hooks[eventName]
  expect(Array.isArray(groups)).toBe(true)
  return groups as unknown[]
}

describe('legacy managed-hook residue cleanup', () => {
  it('INV-B1 removes only OpenCove Claude groups and preserves coexisting groups byte-for-byte', () => {
    const input = JSON.parse(fixture('claude-coexist.input.json')) as unknown
    const expected = JSON.parse(fixture('claude-coexist.expected.json')) as unknown
    const originalOrcaGroup = eventGroups(input, 'UserPromptSubmit')[1]
    const originalThirdPartyGroup = eventGroups(input, 'PostToolUse')[0]
    const orcaBytes = Buffer.from(JSON.stringify(originalOrcaGroup))
    const thirdPartyBytes = Buffer.from(JSON.stringify(originalThirdPartyGroup))

    const result = cleanLegacyClaudeSettings(input)
    const retainedOrcaGroup = eventGroups(result.content, 'UserPromptSubmit')[0]
    const retainedThirdPartyGroup = eventGroups(result.content, 'PostToolUse')[0]

    expect(result).toEqual({ content: expected, removedCount: 3 })
    expect(retainedOrcaGroup).toBe(originalOrcaGroup)
    expect(retainedThirdPartyGroup).toBe(originalThirdPartyGroup)
    expect(Buffer.from(JSON.stringify(retainedOrcaGroup))).toEqual(orcaBytes)
    expect(Buffer.from(JSON.stringify(retainedThirdPartyGroup))).toEqual(thirdPartyBytes)
  })

  it('INV-B1 identifies only a Codex hooks file with the exact frozen OpenCove description', () => {
    const managed = {
      description: LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION,
      hooks: { PreToolUse: [{ hooks: [{ command: 'legacy OpenCove command' }] }] },
    }
    const thirdParty = {
      ...managed,
      description: `${LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION} (copied)`,
    }

    expect(isLegacyOpenCoveCodexHooksFile(managed)).toBe(true)
    expect(isLegacyOpenCoveCodexHooksFile(thirdParty)).toBe(false)
    expect(isLegacyOpenCoveCodexHooksFile(null)).toBe(false)
  })

  it('INV-B1 preserves third-party Codex groups while removing explicitly marked groups', () => {
    const thirdPartyGroup = {
      hooks: [{ type: 'command', command: '/Applications/Orca.app/Contents/MacOS/orca hook' }],
    }
    const managedGroup = {
      description: LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION,
      hooks: [{ type: 'command', command: 'legacy' }],
    }
    const input = {
      description: 'Third-party hooks',
      hooks: { PreToolUse: [managedGroup, thirdPartyGroup] },
    }
    const thirdPartyBytes = Buffer.from(JSON.stringify(thirdPartyGroup))

    const result = cleanLegacyCodexHooksFile(input)
    const retained = eventGroups(result.content, 'PreToolUse')[0]

    expect(result.removedCount).toBe(1)
    expect(retained).toBe(thirdPartyGroup)
    expect(Buffer.from(JSON.stringify(retained))).toEqual(thirdPartyBytes)
    expect(asRecord(result.content).description).toBe('Third-party hooks')
  })

  it('INV-B1 removes only Codex state tables that reference the legacy hooks file', () => {
    const input = fixture('codex-config-coexist.input.toml')
    const expected = fixture('codex-config-coexist.expected.toml')

    expect(cleanLegacyCodexConfigToml(input)).toEqual({ content: expected, removedCount: 2 })
  })

  it('INV-B2 removes empty Claude event and hooks keys while preserving other top-level keys', () => {
    const input = {
      env: { OPEN_COVE_USER_VALUE: 'keep' },
      hooks: {
        Notification: [
          {
            hooks: [
              {
                statusMessage: LEGACY_MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
                command: 'legacy',
              },
            ],
          },
        ],
      },
      theme: 'light',
      attribution: 'keep',
      skipDangerousModePermissionPrompt: false,
    }

    expect(cleanLegacyClaudeSettings(input)).toEqual({
      content: {
        env: { OPEN_COVE_USER_VALUE: 'keep' },
        theme: 'light',
        attribution: 'keep',
        skipDangerousModePermissionPrompt: false,
      },
      removedCount: 1,
    })
  })

  it('INV-B3 is idempotent across Claude JSON, Codex JSON, and Codex TOML', () => {
    const claudeFirst = cleanLegacyClaudeSettings(
      JSON.parse(fixture('claude-coexist.input.json')) as unknown,
    )
    const claudeSecond = cleanLegacyClaudeSettings(claudeFirst.content)
    expect(claudeSecond).toEqual({ content: claudeFirst.content, removedCount: 0 })
    expect(claudeSecond.content).toBe(claudeFirst.content)

    const codexFirst = cleanLegacyCodexHooksFile({
      hooks: {
        Stop: [{ hooks: [{ description: LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION }] }],
      },
    })
    const codexSecond = cleanLegacyCodexHooksFile(codexFirst.content)
    expect(codexSecond).toEqual({ content: codexFirst.content, removedCount: 0 })
    expect(codexSecond.content).toBe(codexFirst.content)

    const tomlFirst = cleanLegacyCodexConfigToml(fixture('codex-config-coexist.input.toml'))
    const tomlSecond = cleanLegacyCodexConfigToml(tomlFirst.content)
    expect(tomlSecond).toEqual({ content: tomlFirst.content, removedCount: 0 })
  })

  it('INV-B4 leaves serializable JSON and a structurally intact TOML document', () => {
    const claude = cleanLegacyClaudeSettings(
      JSON.parse(fixture('claude-coexist.input.json')) as unknown,
    )
    expect(() => JSON.parse(JSON.stringify(claude.content))).not.toThrow()

    const toml = cleanLegacyCodexConfigToml(fixture('codex-config-coexist.input.toml'))
    expect(toml.content).toBe(fixture('codex-config-coexist.expected.toml'))
    expect(toml.content).toContain('[features]\nhooks = true')
    expect(toml.content).toContain('[projects."/repo"]\ntrust_level = "trusted"')
  })

  it('INV-B4 matches only exact table headers for the legacy .codex/hooks.json path', () => {
    const similarHeaders = [
      '[hooks.state."/tmp/hooks.json:stop:0:0"]',
      '[hooks.state."/tmp/.codex/hooks.json.backup:stop:0:0"]',
      '[hooks.state."/tmp/.codex/my-hooks.json:stop:0:0"]',
      'value = "[hooks.state.\\"/tmp/.codex/hooks.json:stop:0:0\\"]"',
      '[hooks.state]',
    ].join('\n')

    expect(cleanLegacyCodexConfigToml(similarHeaders)).toEqual({
      content: similarHeaders,
      removedCount: 0,
    })
  })

  it('preserves CRLF bytes around a removed Codex hooks.state table', () => {
    const input =
      '[hooks.state."C:\\\\Users\\\\redacted\\\\.codex\\\\hooks.json:stop:0:0"]\r\n' +
      'trusted_hash = "sha256:legacy"\r\n' +
      '[features]\r\n' +
      'hooks = true\r\n'

    expect(cleanLegacyCodexConfigToml(input)).toEqual({
      content: '[features]\r\nhooks = true\r\n',
      removedCount: 1,
    })
  })

  it('counts every removed Codex hooks.state table', () => {
    const input = Array.from(
      { length: 10 },
      (_, index) =>
        `[hooks.state."/Users/redacted/.codex/hooks.json:event_${index}:0:0"]\ntrusted_hash = "sha256:${index}"\n`,
    ).join('\n')

    expect(cleanLegacyCodexConfigToml(input)).toEqual({ content: '', removedCount: 10 })
  })

  it('INV-B5 treats absent shapes and damaged TOML as safe no-ops', () => {
    for (const value of [null, undefined, '{ damaged', [], { theme: 'dark' }, { hooks: null }]) {
      expect(cleanLegacyClaudeSettings(value)).toEqual({ content: value, removedCount: 0 })
      expect(cleanLegacyCodexHooksFile(value)).toEqual({ content: value, removedCount: 0 })
    }

    const damaged = '[hooks.state."/tmp/.codex/hooks.json:stop:0:0"]\nkey = true\n[broken'
    expect(cleanLegacyCodexConfigToml(damaged)).toEqual({ content: damaged, removedCount: 0 })
  })
})
