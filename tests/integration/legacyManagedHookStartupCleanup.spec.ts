import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLegacyManagedHooksAtStartup } from '../../src/contexts/agent/infrastructure/cleanupLegacyManagedHooksAtStartup'
import {
  LEGACY_MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
  LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION,
} from '../../src/contexts/agent/infrastructure/legacyManagedHookCleanup'

const temporaryHomes: string[] = []

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map(async path => await rm(path, { recursive: true })))
})

describe('legacy managed hook startup cleanup', () => {
  it('removes exact OpenCove residue while preserving 66 coexisting Orca groups', async () => {
    const home = await createTemporaryHome()
    const claudePath = join(home, '.claude', 'settings.json')
    const codexHooksPath = join(home, '.codex', 'hooks.json')
    const codexConfigPath = join(home, '.codex', 'config.toml')
    const orcaGroups = Array.from({ length: 66 }, (_, index) => ({
      description: `Orca agent hook ${String(index)}`,
      hooks: [{ type: 'command', command: `/opt/orca/hook-${String(index)}` }],
    }))
    const legacyClaudeGroup = {
      hooks: [
        {
          type: 'command',
          command: '/obsolete/opencove/claude-status.mjs',
          statusMessage: LEGACY_MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
        },
      ],
    }
    const claudeSettings = {
      theme: 'dark',
      permissions: { allow: ['Read'] },
      hooks: {
        PreToolUse: [legacyClaudeGroup, ...orcaGroups],
        SessionEnd: [legacyClaudeGroup],
      },
    }
    const codexHooks = {
      description: 'Orca and user hooks',
      hooks: {
        SessionStart: [
          { description: LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION, hooks: [] },
          ...orcaGroups,
        ],
      },
    }
    const orcaTomlBlock = [
      '[hooks.state."/Users/test/.orca/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:orca"',
      '',
    ].join('\n')
    const codexConfig = [
      'model = "user-model"',
      '',
      '[hooks.state."/Users/test/.codex/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:obsolete-opencove"',
      '',
      orcaTomlBlock,
      '[projects."/workspace"]',
      'trust_level = "trusted"',
      '',
    ].join('\n')
    await Promise.all([
      writeFile(claudePath, `${JSON.stringify(claudeSettings, null, 2)}\n`),
      writeFile(codexHooksPath, `${JSON.stringify(codexHooks, null, 2)}\n`),
      writeFile(codexConfigPath, codexConfig),
    ])
    const expectedOrcaBytes = Buffer.from(JSON.stringify(orcaGroups))

    const report = await cleanupLegacyManagedHooksAtStartup(home)

    expect(report.failures).toEqual([])
    expect(report.removedCount).toBe(4)
    const cleanedClaude = JSON.parse(await readFile(claudePath, 'utf8')) as typeof claudeSettings
    const cleanedCodex = JSON.parse(await readFile(codexHooksPath, 'utf8')) as typeof codexHooks
    expect(cleanedClaude).toMatchObject({
      theme: 'dark',
      permissions: { allow: ['Read'] },
    })
    expect(Buffer.from(JSON.stringify(cleanedClaude.hooks.PreToolUse))).toEqual(expectedOrcaBytes)
    expect(cleanedClaude.hooks).not.toHaveProperty('SessionEnd')
    expect(Buffer.from(JSON.stringify(cleanedCodex.hooks.SessionStart))).toEqual(expectedOrcaBytes)
    const cleanedToml = await readFile(codexConfigPath, 'utf8')
    expect(cleanedToml).not.toContain('obsolete-opencove')
    expect(cleanedToml).toContain(orcaTomlBlock)
    expect(cleanedToml).toContain('trust_level = "trusted"')

    const stableBytes = await Promise.all(
      [claudePath, codexHooksPath, codexConfigPath].map(async path => await readFile(path)),
    )
    await expect(cleanupLegacyManagedHooksAtStartup(home)).resolves.toEqual({
      removedCount: 0,
      failures: [],
    })
    await expect(
      Promise.all(
        [claudePath, codexHooksPath, codexConfigPath].map(async path => await readFile(path)),
      ),
    ).resolves.toEqual(stableBytes)
  })

  it('deletes a Codex hooks file marked as entirely OpenCove-owned', async () => {
    const home = await createTemporaryHome()
    const codexHooksPath = join(home, '.codex', 'hooks.json')
    await writeFile(
      codexHooksPath,
      JSON.stringify({ description: LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION, hooks: {} }),
    )

    await expect(cleanupLegacyManagedHooksAtStartup(home)).resolves.toEqual({
      removedCount: 1,
      failures: [],
    })
    await expect(access(codexHooksPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes trust entries when the whole Codex hooks file is OpenCove-owned', async () => {
    const home = await createTemporaryHome()
    const codexHooksPath = join(home, '.codex', 'hooks.json')
    const codexConfigPath = join(home, '.codex', 'config.toml')
    const codexConfig = [
      'model = "user-model"',
      '',
      '[hooks.state."/Users/test/.codex/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:obsolete-opencove"',
      '',
      '[projects."/workspace"]',
      'trust_level = "trusted"',
      '',
    ].join('\n')
    await Promise.all([
      writeFile(
        codexHooksPath,
        JSON.stringify({ description: LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION, hooks: {} }),
      ),
      writeFile(codexConfigPath, codexConfig),
    ])

    await expect(cleanupLegacyManagedHooksAtStartup(home)).resolves.toEqual({
      removedCount: 2,
      failures: [],
    })
    await expect(access(codexHooksPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const cleanedToml = await readFile(codexConfigPath, 'utf8')
    expect(cleanedToml).not.toContain('obsolete-opencove')
    expect(cleanedToml).toContain('trust_level = "trusted"')
  })

  it('leaves a user-owned Codex hooks file and its trust entries untouched', async () => {
    const home = await createTemporaryHome()
    const codexHooksPath = join(home, '.codex', 'hooks.json')
    const codexConfigPath = join(home, '.codex', 'config.toml')
    const userHooks = {
      description: 'My own hooks',
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: '/Users/test/bin/my-hook' }] }],
      },
    }
    const codexConfig = [
      'model = "user-model"',
      '',
      '[hooks.state."/Users/test/.codex/hooks.json:pre_tool_use:0:0"]',
      'trusted_hash = "sha256:user-owned"',
      '',
      '[projects."/workspace"]',
      'trust_level = "trusted"',
      '',
    ].join('\n')
    const userHooksText = `${JSON.stringify(userHooks, null, 2)}\n`
    await Promise.all([
      writeFile(codexHooksPath, userHooksText),
      writeFile(codexConfigPath, codexConfig),
    ])

    await expect(cleanupLegacyManagedHooksAtStartup(home)).resolves.toEqual({
      removedCount: 0,
      failures: [],
    })
    await expect(readFile(codexHooksPath, 'utf8')).resolves.toBe(userHooksText)
    await expect(readFile(codexConfigPath, 'utf8')).resolves.toBe(codexConfig)
  })

  it('leaves trust entries untouched when there is no Codex hooks file', async () => {
    const home = await createTemporaryHome()
    const codexConfigPath = join(home, '.codex', 'config.toml')
    const codexConfig = [
      'model = "user-model"',
      '',
      '[hooks.state."/Users/test/.codex/hooks.json:pre_tool_use:0:0"]',
      'trusted_hash = "sha256:orphaned"',
      '',
    ].join('\n')
    await writeFile(codexConfigPath, codexConfig)

    await expect(cleanupLegacyManagedHooksAtStartup(home)).resolves.toEqual({
      removedCount: 0,
      failures: [],
    })
    await expect(readFile(codexConfigPath, 'utf8')).resolves.toBe(codexConfig)
  })
})

async function createTemporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'opencove-legacy-hooks-'))
  temporaryHomes.push(home)
  await Promise.all([
    mkdir(join(home, '.claude'), { recursive: true }),
    mkdir(join(home, '.codex'), { recursive: true }),
  ])
  return home
}
