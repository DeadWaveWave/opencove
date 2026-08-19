import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Locks down which repository paths are allowed into the packaged app (app.asar).
 *
 * electron-builder does NOT read .gitignore. With `build.files` unset it packages `**\/*` with
 * `dot: true`, minus a hardcoded exclusion list (.git, .github, .idea, ...). That list cannot know
 * about this project's own directories, so a local `.opencove/` -- which holds full git worktrees of
 * other branches -- was swept into a locally built release: 5951 of 19762 asar entries, including
 * unreleased source from unmerged branches.
 *
 * The fix is an allowlist, not a longer denylist, because a denylist is exactly what already failed:
 * anything added to the repo later is included by default and nobody notices.
 *
 * These tests reimplement electron-builder's own `minimatchAll` (app-builder-lib/out/util/filter.js)
 * against the real config, so they assert packaging behavior rather than comparing config strings.
 * Directory cases matter as much as file cases: the walker does not descend into a directory that
 * fails the filter, so a pattern like `out/**\/*` -- which matches `out/main/index.js` but NOT `out`
 * -- silently packages nothing. That exact mistake produced a "corrupted archive: out/main/index.js
 * was not found" build failure that a file-only assertion had passed.
 */

const projectRoot = resolve(__dirname, '../../..')
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
  main: string
  build: { files?: string[]; asarUnpack?: string[] }
}

const filePatterns = packageJson.build.files ?? []

const require = createRequire(import.meta.url)
const { Minimatch } = require('minimatch') as {
  Minimatch: new (
    pattern: string,
    options: { dot: boolean },
  ) => { negate: boolean; match: (target: string, partial?: boolean) => boolean }
}

/**
 * electron-builder prepends these before the configured patterns; `node_modules` is collected from
 * the dependency tree instead of these globs, and the output/build dirs are always excluded.
 */
const BUILDER_LEADING_PATTERNS = ['!**/node_modules/**', '!build{,/**/*}', '!dist{,/**/*}']

const compiledPatterns = [...BUILDER_LEADING_PATTERNS, ...filePatterns].map(
  pattern => new Minimatch(pattern, { dot: true }),
)

/** Verbatim port of app-builder-lib's `minimatchAll`, including its partial-match rule for dirs. */
function isPackaged(relativePath: string, isDirectory = false): boolean {
  let match = false
  for (const pattern of compiledPatterns) {
    if (match !== pattern.negate) {
      continue
    }
    match = pattern.match(relativePath, isDirectory && !pattern.negate)
  }
  return match
}

describe('packaged app file set', () => {
  it('declares an explicit allowlist', () => {
    // Without this, electron-builder's default `**/*` applies and every future top-level directory
    // ships by default.
    expect(filePatterns.length).toBeGreaterThan(0)
  })

  describe('excludes local state that must never ship', () => {
    // `.opencove` is the concrete leak: gitignored, untracked, 4.1 GB of git worktrees on the
    // machine where this was found.
    it.each([
      ['.opencove'],
      ['.opencove/worktrees/some-branch/src/app/main/index.ts'],
      ['.opencove/ui-audit/report.json'],
      ['tests'],
      ['tests/e2e/issue-report.spec.ts'],
      ['test-results/junit.xml'],
      ['playwright-report/index.html'],
      ['docs/runtime/RELEASING.md'],
      ['artifacts/build.log'],
      ['harness/agent.mjs'],
      ['coverage/lcov.info'],
      ['.env'],
      ['.env.local'],
      ['scripts/create-standalone-server-bundle.mjs'],
    ])('does not package %s', candidate => {
      expect(isPackaged(candidate)).toBe(false)
    })

    it('does not package TypeScript sources that only exist to be compiled', () => {
      // The renderer/main sources are consumed from out/ after bundling; shipping src/ wholesale
      // would put ~1400 extra files in the archive for no runtime benefit.
      expect(isPackaged('src/app/main/index.ts')).toBe(false)
      expect(isPackaged('src/contexts/issueReport/application/IssueReportDocument.ts')).toBe(false)
    })
  })

  describe('keeps everything the app loads at runtime', () => {
    it('packages the main entry point declared in package.json#main', () => {
      // `main` is "./out/main/index.js"; Electron cannot boot without it.
      const mainEntry = packageJson.main.replace(/^\.\//, '')

      expect(isPackaged(mainEntry)).toBe(true)
    })

    it.each([['out/preload/index.js'], ['out/renderer/index.html'], ['package.json']])(
      'packages %s',
      candidate => {
        expect(isPackaged(candidate)).toBe(true)
      },
    )

    it('packages the standalone server CLI entry point', () => {
      // scripts/create-standalone-server-bundle.mjs launches the headless server through
      // `app/src/app/cli/opencove.mjs` inside the extracted asar, so this path is load-bearing --
      // trimming the asar to out/ alone would break the Linux server that #353 exists to fix.
      expect(isPackaged('src/app/cli/opencove.mjs')).toBe(true)
    })

    it('packages every path listed in asarUnpack', () => {
      // A path cannot be unpacked from the archive if it was never packaged into it.
      for (const pattern of packageJson.build.asarUnpack ?? []) {
        expect(isPackaged(pattern), `asarUnpack path not packaged: ${pattern}`).toBe(true)
      }
    })

    it('lets the walker descend into every ancestor directory it must traverse', () => {
      // The walker skips a directory that fails the filter, so an ancestor that does not match
      // makes everything beneath it unreachable no matter how well the leaf pattern matches.
      for (const directory of [
        'out',
        'out/main',
        'out/renderer',
        'src',
        'src/app',
        'src/app/cli',
      ]) {
        expect(isPackaged(directory, true), `walker cannot descend into ${directory}`).toBe(true)
      }
    })
  })
})
