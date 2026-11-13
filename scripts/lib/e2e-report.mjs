import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const BUDGET_DIRECTORY = 'tests/e2e/budget'
const PARTS = 4

export function normalizeE2EFile(file) {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '')
  const index = normalized.indexOf('tests/e2e/')
  return index >= 0 ? normalized.slice(index) : `tests/e2e/${normalized}`
}

// The outer suite owns the spec file. spec.file can point into a shared test factory.
// Ignore Playwright's opaque ID, source lines, project names and runner paths.
export function collectCases(report, { allowErrors = false, mergeRepeats = false } = {}) {
  if (!Array.isArray(report?.suites) || (!allowErrors && report.errors?.length)) {
    throw new Error(`Invalid Playwright discovery: ${JSON.stringify(report?.errors ?? [])}`)
  }
  const cases = new Map()
  function visit(suite, file, parents) {
    for (const spec of suite.specs ?? []) {
      const title = [...parents, spec.title].join(' › ')
      const id = `${file} › ${title}`
      if (cases.has(id)) {
        if (!mergeRepeats) {
          throw new Error(`Duplicate stable ID: ${id}`)
        }
        cases.get(id).spec.tests.push(...(spec.tests ?? []))
        continue
      }
      cases.set(id, {
        id,
        file,
        title,
        sourceFile: normalizeE2EFile(spec.file ?? file),
        spec: { ...spec, tests: [...(spec.tests ?? [])] },
      })
    }
    for (const child of suite.suites ?? []) {
      visit(child, file, [...parents, child.title])
    }
  }
  for (const suite of report.suites) {
    visit(suite, normalizeE2EFile(suite.file), [])
  }
  if (!cases.size && !allowErrors) {
    throw new Error('No E2E cases discovered; refusing empty baseline.')
  }
  return [...cases.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Stable hash partitions keep generated JSON reviewable and below the source line limit.
export function readBaselineParts(directory, name) {
  const entries = {}
  for (let part = 0; part < PARTS; part++) {
    const data = JSON.parse(readFileSync(resolve(directory, `${name}-${part}.json`), 'utf8'))
    if (data.version !== 1 || !data.entries || data.count !== Object.keys(data.entries).length) {
      throw new Error(`Invalid baseline: ${name}-${part}.json`)
    }
    for (const [id, value] of Object.entries(data.entries)) {
      if (Object.hasOwn(entries, id)) {
        throw new Error(`Duplicate baseline ID: ${id}`)
      }
      entries[id] = value
    }
  }
  return entries
}

export async function writeBaselineParts(directory, name, entries) {
  const { format } = await import('prettier')
  const partitions = Array.from({ length: PARTS }, () => ({}))
  for (const id of Object.keys(entries).sort()) {
    const part = createHash('sha256').update(id).digest()[0] % PARTS
    partitions[part][id] = entries[id]
  }
  mkdirSync(directory, { recursive: true })
  const contents = await Promise.all(
    partitions.map(values =>
      format(JSON.stringify({ version: 1, count: Object.keys(values).length, entries: values }), {
        parser: 'json',
        printWidth: 100,
      }),
    ),
  )
  for (const [part, content] of contents.entries()) {
    writeFileSync(resolve(directory, `${name}-${part}.json`), content)
  }
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
