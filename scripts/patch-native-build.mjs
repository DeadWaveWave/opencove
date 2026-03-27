/**
 * patch-native-build.mjs
 *
 * Re-applies the three patches needed to build OpenCove with VS 2025/2026 Build Tools.
 * Run automatically via postinstall (pnpm install re-runs this after node_modules changes).
 *
 * Patches:
 *   1. node-gyp/find-visualstudio.js  — adds VS 2025 (versionMajor 18) support
 *   2. node-gyp/build.js              — disables Spectre mitigation (libraries not installed)
 *   3. app-builder-lib/winPackager.js — calls rcedit directly from cache (avoids macOS symlink failure)
 */

import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(__dirname, '..')

function patchFile(filePath, patches) {
  let src = readFileSync(filePath, 'utf8')
  let changed = false
  for (const { search, replace, label } of patches) {
    if (src.includes(replace)) {
      console.log(`  [skip] already patched: ${label}`)
      continue
    }
    if (!src.includes(search)) {
      console.log(`  [warn] search string not found — skipping: ${label}`)
      continue
    }
    src = src.replace(search, replace)
    changed = true
    console.log(`  [ok]   applied: ${label}`)
  }
  if (changed) writeFileSync(filePath, src, 'utf8')
}

// ─── Patch 1: node-gyp find-visualstudio.js ───────────────────────────────────
const findVsPath = join(
  root,
  'node_modules/.pnpm/node-gyp@11.5.0/node_modules/node-gyp/lib/find-visualstudio.js'
)

console.log('\n[patch-native-build] Patching node-gyp/find-visualstudio.js ...')
patchFile(findVsPath, [
  {
    label: 'findVSFromSpecifiedLocation — add 2025',
    search: 'return this.findVSFromSpecifiedLocation([2019, 2022])',
    replace: 'return this.findVSFromSpecifiedLocation([2019, 2022, 2025])',
  },
  {
    label: 'findNewVSUsingSetupModule — add 2025',
    search: 'return this.findNewVSUsingSetupModule([2019, 2022])',
    replace: 'return this.findNewVSUsingSetupModule([2019, 2022, 2025])',
  },
  {
    label: 'findNewVS — add 2025',
    search: 'return this.findNewVS([2019, 2022])',
    replace: 'return this.findNewVS([2019, 2022, 2025])',
  },
  {
    label: 'versionMajor 18 → versionYear 2025',
    search:
      '    if (ret.versionMajor === 17) {\n      ret.versionYear = 2022\n      return ret\n    }',
    replace:
      '    if (ret.versionMajor === 17) {\n      ret.versionYear = 2022\n      return ret\n    }\n    if (ret.versionMajor === 18) {\n      ret.versionYear = 2025\n      return ret\n    }',
  },
  {
    label: 'toolset v145 for versionYear 2025',
    search:
      "} else if (versionYear === 2022) {\n      return 'v143'\n    }",
    replace:
      "} else if (versionYear === 2022) {\n      return 'v143'\n    } else if (versionYear === 2025) {\n      return 'v145'\n    }",
  },
])

// ─── Patch 2: node-gyp build.js ───────────────────────────────────────────────
const buildPath = join(
  root,
  'node_modules/.pnpm/node-gyp@11.5.0/node_modules/node-gyp/lib/build.js'
)

console.log('\n[patch-native-build] Patching node-gyp/build.js ...')
patchFile(buildPath, [
  {
    label: 'SpectreMitigation=false',
    search:
      "      argv.push('/p:Configuration=' + buildType + ';Platform=' + p)\n      if (jobs)",
    replace:
      "      argv.push('/p:Configuration=' + buildType + ';Platform=' + p)\n      argv.push('/p:SpectreMitigation=false')\n      if (jobs)",
  },
])

// ─── Patch 3: app-builder-lib winPackager.js ──────────────────────────────────
const winPackagerGlob = join(
  root,
  'node_modules/.pnpm'
)

// Find the correct versioned path (handles future version bumps)
import { readdirSync, existsSync } from 'fs'
let winPackagerPath = null
for (const dir of readdirSync(winPackagerGlob)) {
  if (dir.startsWith('app-builder-lib@')) {
    const candidate = join(winPackagerGlob, dir, 'node_modules/app-builder-lib/out/winPackager.js')
    if (existsSync(candidate)) {
      winPackagerPath = candidate
      break
    }
  }
}

if (!winPackagerPath) {
  console.log('\n[patch-native-build] [warn] winPackager.js not found — skipping patch 3')
} else {
  console.log('\n[patch-native-build] Patching app-builder-lib/winPackager.js ...')
  patchFile(winPackagerPath, [
    {
      label: 'rcedit direct cache call (bypass winCodeSign extraction)',
      search:
        `        const timer = (0, timer_1.time)("wine&sign");
        // rcedit crashed of executed using wine, resourcehacker works
        if (process.platform === "win32" || process.platform === "darwin") {
            await (0, builder_util_1.executeAppBuilder)(["rcedit", "--args", JSON.stringify(args)], undefined /* child-process */, {}, 3 /* retry three times */);
        }`,
      replace:
        `        const timer = (0, timer_1.time)("wine&sign");
        // rcedit crashed of executed using wine, resourcehacker works
        if (process.platform === "win32" || process.platform === "darwin") {
            // PATCHED: call rcedit-x64.exe directly from electron-builder cache to avoid
            // winCodeSign re-extraction failing on macOS symlinks (requires Developer Mode)
            const nodePath = require("path");
            const nodeFs = require("fs");
            const winCodeSignCache = nodePath.join(process.env.LOCALAPPDATA || require("os").homedir(), "electron-builder", "Cache", "winCodeSign");
            let rceditExe = null;
            if (nodeFs.existsSync(winCodeSignCache)) {
                for (const dir of nodeFs.readdirSync(winCodeSignCache).filter(d => !d.endsWith(".7z"))) {
                    const candidate = nodePath.join(winCodeSignCache, dir, "rcedit-x64.exe");
                    if (nodeFs.existsSync(candidate)) { rceditExe = candidate; break; }
                }
            }
            if (rceditExe) {
                builder_util_1.log.info({ rceditExe }, "calling rcedit directly from cache");
                const { execFileSync } = require("child_process");
                execFileSync(rceditExe, args, { stdio: "inherit" });
            } else {
                await (0, builder_util_1.executeAppBuilder)(["rcedit", "--args", JSON.stringify(args)], undefined /* child-process */, {}, 3 /* retry three times */);
            }
        }`,
    },
  ])
}

console.log('\n[patch-native-build] Done.\n')
