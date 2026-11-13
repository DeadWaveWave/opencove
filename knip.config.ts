import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import type { KnipConfig } from 'knip'
import {
  CLI_ENTRY,
  MAIN_ENTRIES,
  PRELOAD_ENTRIES,
  RENDERER_HTML_ENTRIES,
  RENDERER_ROOT,
} from './scripts/lib/build-entries.mjs'

// knip's built-in plugins do not understand electron-vite's three build targets, so every
// production entry is declared here. The build entries come from scripts/lib/build-entries.mjs,
// the same module electron-vite and scripts/build-cli.mjs read, so the three cannot drift.
// Run in production mode (`knip --production`): only entries marked with `!` count and spec
// files are not users. There is deliberately no `ignore` of any file or directory.

/** The `<script type="module" src>` of a renderer HTML page is that page's real entry. */
function rendererHtmlScriptEntry(htmlPath: string): string {
  const html = readFileSync(htmlPath, 'utf8')
  const match = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i.exec(html)
  if (!match?.[1]) {
    throw new Error(`knip.config.ts: ${htmlPath} has no <script type="module" src> tag.`)
  }
  const src = match[1]
  // Vite resolves a leading "/" against the renderer root, as it does for "./".
  return posix.join(RENDERER_ROOT, src.replace(/^\//, ''))
}

/** Source files that electron-builder packs verbatim (package.json `build.files`). */
function packagedSourceEntries(): string[] {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { build?: { files?: string[] } }
  return (pkg.build?.files ?? []).filter(
    file => file.startsWith('src/') && /\.(mjs|cjs)$/.test(file),
  )
}

const entry = [
  ...Object.values(MAIN_ENTRIES),
  ...Object.values(PRELOAD_ENTRIES),
  ...Object.values(RENDERER_HTML_ENTRIES).map(rendererHtmlScriptEntry),
  CLI_ENTRY,
  ...packagedSourceEntries(),
  // Dev tooling run by package scripts and CI: they are entries, not dead code.
  'scripts/**/*.{mjs,cjs,ts}',
  // Harness entry scripts (pnpm harness:check, arch:*); its specs are not entries.
  'harness/*.mjs',
  'harness/architecture/*.mjs',
  'electron.vite.config.ts',
].map(file => `${file}!`)

const config: KnipConfig = {
  entry,
  project: ['src/**/*.{ts,tsx,mjs,cjs}!'],
  // An export that its own file also uses is never reported; what remains is an export that
  // only tests keep alive.
  ignoreExportsUsedInFile: true,
  // OS executables spawned by name (Windows process and registry tooling, Linux notifications),
  // not npm packages.
  ignoreBinaries: ['taskkill.exe', 'reg.exe', 'where.exe', 'notify-send', 'subst'],
}

export default config
