// Assembles the impact report: the data behind the human, brief and `--json` outputs.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { selectPrecommitE2E } from '../../precommit-e2e-selection.mjs'
import { resolveFileReadDependentTests } from '../file-read-dependents.mjs'
import { areaOf } from './areas.mjs'
import { STALE_AFTER_DAYS, findMissingPartners, indexAgeDays } from './cochange.mjs'
import {
  createImportGraph,
  describeLayer,
  findImportLink,
  findImporters,
  groupImportersByArea,
  isRelatedTestPath,
} from './graph.mjs'

export const REPORT_SCHEMA_VERSION = 1

export const LIMITS = [
  'Not covered: string, IPC and DI coupling, CSS and locale files, dynamic imports, files with no history. See DEVELOPMENT.md.',
  'Related tests follow static imports (re-exports included) and FILE_READ_DEPENDENTS, not runtime behaviour.',
  'Co-change partners say what usually changes together, not what must.',
]

function e2eSelection(changes) {
  if (changes.length === 0) {
    return { groups: [] }
  }
  const selection = selectPrecommitE2E({ changes })
  return {
    groups: selection.groups.map(({ id, reason, tests, paths }) => ({ id, reason, tests, paths })),
  }
}

/** `input`: `{ mode, base?, changes }`; `index`: a parsed co-change index. */
export async function buildReport({ root, input, index, source, now = new Date() }) {
  const files = [...new Set(input.changes.map(change => change.path))].sort()
  const graph = await createImportGraph(root)
  const { missing, noHistory, droppedStalePaths } = findMissingPartners(index, files, {
    exists: path => existsSync(join(root, path)),
  })

  const areaMap = new Map()
  for (const file of files) {
    const area = areaOf(file)
    const entry = areaMap.get(area) ?? { area, layers: {}, files: [] }
    const layer = describeLayer(graph, file)
    if (layer) {
      entry.layers[layer] = (entry.layers[layer] ?? 0) + 1
    }
    entry.files.push(file)
    areaMap.set(area, entry)
  }

  const importers = {}
  const testSet = new Set(resolveFileReadDependentTests(files))
  for (const file of files) {
    if (isRelatedTestPath(file)) {
      testSet.add(file)
    }
    const found = findImporters(graph, file)
    for (const importer of found) {
      if (isRelatedTestPath(importer.file)) {
        testSet.add(importer.file)
      }
    }
    const sourceImporters = found.filter(importer => importer.file.startsWith('src/'))
    if (sourceImporters.length > 0) {
      importers[file] = {
        byArea: groupImportersByArea(sourceImporters),
        runtime: sourceImporters.filter(importer => importer.kind === 'runtime').length,
        typeOnly: sourceImporters.filter(importer => importer.kind === 'type').length,
      }
    }
  }

  const ageDays = indexAgeDays(index, now)
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    input: { mode: input.mode, ...(input.base ? { base: input.base } : {}), files },
    areas: [...areaMap.values()].sort((a, b) => (a.area < b.area ? -1 : 1)),
    importers,
    cochange: {
      source: {
        kind: source,
        throughCommit: index.throughCommit,
        throughDate: index.throughDate,
        ageDays,
        stale: source === 'index' && ageDays > STALE_AFTER_DAYS,
      },
      missing: missing.map(item => ({
        ...item,
        importLink: findImportLink(graph, item.file, item.partner),
      })),
      noHistory,
      droppedStalePaths,
    },
    tests: [...testSet].sort(),
    e2e: e2eSelection(input.changes),
    limits: LIMITS,
  }
}
