// Import graph for `pnpm impact`: importers (re-exports followed through), related tests, layers.
// Reuses the architecture harness for file discovery, alias resolution, layers and import edges.
// Only files whose text mentions a changed module's name are parsed, which keeps a run short.
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import {
  classifyLayer,
  collectSourceFiles,
  loadArchitectureConfig,
  resolveInternalSpecifier,
  toRelativeProjectPath,
} from '../../../harness/architecture/lib/architecture-rules.mjs'
import { readImportEdgesFromSource } from '../../../harness/architecture/lib/import-edges.mjs'
import { areaOf } from './areas.mjs'

const SPEC_PATTERN = /\.spec\.[cm]?[jt]sx?$/
// Playwright suites do not follow `vitest related`; the E2E section covers them.
const PLAYWRIGHT_TEST_PREFIXES = [
  'tests/e2e/',
  'tests/e2e-web-canvas/',
  'tests/e2e-web-shell/',
  'tests/perf/',
]

const KIND_RANK = { runtime: 2, type: 1 }

// A specifier that resolves to a module always contains its file name, or its folder's name for an
// `index` file (imported as the folder), so a text without that word cannot import it.
function needlesOf(file) {
  const stem = basename(file, extname(file))
  return stem === 'index' ? ['index', basename(dirname(file))] : [stem]
}

export async function createImportGraph(root) {
  const absoluteRoot = resolve(root)
  const config = await loadArchitectureConfig()
  const sourceFiles = await collectSourceFiles(absoluteRoot, config)
  const testFiles = await collectSourceFiles(absoluteRoot, {
    ...config,
    sourceRoot: 'tests',
    exclude: [],
  })
  const extensions = new Set(config.includeExtensions)
  const texts = new Map()
  await Promise.all(
    [...sourceFiles, ...testFiles].map(async file => {
      texts.set(toRelativeProjectPath(absoluteRoot, file), await readFile(file, 'utf8'))
    }),
  )
  const edgeCache = new Map()

  // The harness resolver returns a folder as it is when a specifier names one, so look for the
  // `index` module inside it.
  const toModule = relativePath => {
    if (texts.has(relativePath)) {
      return relativePath
    }
    const index = [...extensions].map(ext => `${relativePath}/index${ext}`).find(c => texts.has(c))
    return index ?? relativePath
  }

  const edgesOf = file => {
    if (!edgeCache.has(file)) {
      const absolute = resolve(absoluteRoot, file)
      const edges = []
      for (const edge of readImportEdgesFromSource(absolute, texts.get(file) ?? '')) {
        const target = resolveInternalSpecifier(absoluteRoot, absolute, edge.specifier, config)
        if (target) {
          edges.push({
            to: toModule(toRelativeProjectPath(absoluteRoot, target)),
            kind: edge.kind,
            reexport: edge.reexport === true,
          })
        }
      }
      edgeCache.set(file, edges)
    }
    return edgeCache.get(file)
  }

  const directImporters = target => {
    if (!extensions.has(extname(target))) {
      return []
    }
    const needles = needlesOf(target)
    const importers = []
    for (const [file, text] of texts) {
      if (file === target || !needles.some(needle => text.includes(needle))) {
        continue
      }
      for (const edge of edgesOf(file)) {
        if (edge.to === target) {
          importers.push({ from: file, kind: edge.kind, reexport: edge.reexport })
        }
      }
    }
    return importers
  }

  return { config, edgesOf, directImporters, hasFile: file => texts.has(file) }
}

const mergeKind = (left, right) => (KIND_RANK[left] <= KIND_RANK[right] ? left : right)

/**
 * Direct importers plus the importers behind re-export barrels (`export … from`), each marked
 * runtime or type-only; the second kind of importer carries the barrel it came through in `via`.
 */
export function findImporters(graph, file) {
  const found = new Map()
  const record = (from, kind, via) => {
    const existing = found.get(from)
    const better =
      !existing ||
      (existing.via && !via) ||
      (Boolean(existing.via) === Boolean(via) && KIND_RANK[kind] > KIND_RANK[existing.kind])
    if (better) {
      found.set(from, via ? { file: from, kind, via } : { file: from, kind })
    }
  }
  const walk = (target, incomingKind, via, visitedBarrels) => {
    for (const importer of graph.directImporters(target)) {
      const kind = incomingKind ? mergeKind(incomingKind, importer.kind) : importer.kind
      record(importer.from, kind, via)
      if (importer.reexport && !visitedBarrels.has(importer.from)) {
        visitedBarrels.add(importer.from)
        walk(importer.from, kind, via ?? importer.from, visitedBarrels)
      }
    }
  }
  walk(file, null, null, new Set([file]))
  return [...found.values()].sort((a, b) => (a.file < b.file ? -1 : 1))
}

export function groupImportersByArea(importers) {
  const byArea = {}
  for (const importer of importers) {
    ;(byArea[areaOf(importer.file)] ??= []).push(importer)
  }
  return Object.fromEntries(Object.entries(byArea).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export function isRelatedTestPath(file) {
  return (
    SPEC_PATTERN.test(file) &&
    file.startsWith('tests/') &&
    !PLAYWRIGHT_TEST_PREFIXES.some(prefix => file.startsWith(prefix))
  )
}

export function describeLayer(graph, file) {
  return classifyLayer(file, graph.config) ?? (file.startsWith('src/') ? 'other' : null)
}

/** How a partner is linked to a changed file in the direct import graph, if at all. */
export function findImportLink(graph, file, partner) {
  const imports = (from, to) => graph.hasFile(from) && graph.edgesOf(from).some(e => e.to === to)
  const partnerImportsFile = imports(partner, file)
  const fileImportsPartner = imports(file, partner)
  if (partnerImportsFile && fileImportsPartner) {
    return 'both'
  }
  if (partnerImportsFile) {
    return 'partner-imports-file'
  }
  return fileImportsPartner ? 'file-imports-partner' : null
}
