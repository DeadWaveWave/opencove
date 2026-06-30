import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readImportEdgesFromSource } from './import-edges.mjs'

export const defaultArchitectureRulesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'rules.json',
)

const RUNTIME_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']

function normalizePath(pathname) {
  return pathname.replaceAll('\\', '/')
}

function toRelativeProjectPath(root, pathname) {
  return normalizePath(relative(root, pathname))
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern)
  let source = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += escapeRegExp(char)
    }
  }
  return new RegExp(`^${source}$`)
}

function matchesPattern(pathname, pattern) {
  return globToRegExp(pattern).test(normalizePath(pathname))
}

function matchesAnyPattern(pathname, patterns = []) {
  return patterns.some(pattern => matchesPattern(pathname, pattern))
}

async function collectSourceFiles(root, config) {
  const sourceRoot = resolve(root, config.sourceRoot ?? 'src')
  const includeExtensions = new Set(config.includeExtensions ?? RUNTIME_EXTENSIONS)
  const exclude = config.exclude ?? []
  const files = []

  const walk = async directory => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async entry => {
        const childPath = join(directory, entry.name)
        const relativePath = toRelativeProjectPath(root, childPath)
        if (matchesAnyPattern(relativePath, exclude)) {
          return
        }
        if (entry.isDirectory()) {
          await walk(childPath)
        } else if (entry.isFile() && includeExtensions.has(extname(entry.name))) {
          files.push(childPath)
        }
      }),
    )
  }

  await walk(sourceRoot)
  return files.sort()
}

function resolveWithCandidates(pathBase) {
  const candidates = [
    pathBase,
    ...RUNTIME_EXTENSIONS.map(extension => `${pathBase}${extension}`),
    ...RUNTIME_EXTENSIONS.map(extension => join(pathBase, `index${extension}`)),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

function resolveInternalSpecifier(root, fromFile, specifier, config) {
  if (specifier.startsWith('.')) {
    return resolveWithCandidates(resolve(dirname(fromFile), specifier))
  }

  for (const alias of config.aliases ?? []) {
    if (specifier.startsWith(alias.prefix)) {
      const suffix = specifier.slice(alias.prefix.length)
      return resolveWithCandidates(resolve(root, alias.path, suffix))
    }
  }

  return null
}

function classifyLayer(relativePath, config) {
  for (const layer of config.layers ?? []) {
    if (matchesAnyPattern(relativePath, layer.patterns)) {
      return layer.name
    }
  }
  return null
}

function buildAllowedLayerMap(config) {
  const map = new Map()
  for (const entry of config.allowedLayerDependencies ?? []) {
    map.set(entry.from, new Set(entry.to))
  }
  return map
}

function specifierMatchesRule(specifier, rule) {
  if (rule.specifiers?.includes(specifier)) {
    return true
  }
  return (rule.specifierPrefixes ?? []).some(prefix => specifier.startsWith(prefix))
}

function shouldIgnoreForbiddenImportEdge(edge, rule) {
  return edge.kind === 'type' && rule.ignoreTypeOnly === true
}

function createViolation(input) {
  return {
    ruleId: input.ruleId,
    severity: input.severity,
    file: input.file,
    line: input.line,
    message: input.message,
    found: input.found ?? null,
    expected: input.expected ?? null,
    doc: input.doc ?? null,
  }
}

function findRuntimeCycleViolations(edgesByFile, relativeByAbsolute, severity) {
  const graph = new Map()
  for (const [fromFile, edges] of edgesByFile) {
    graph.set(
      fromFile,
      edges.filter(edge => edge.kind === 'runtime' && edge.toFile).map(edge => edge.toFile),
    )
  }

  const indices = new Map()
  const lowlinks = new Map()
  const stack = []
  const onStack = new Set()
  const components = []
  let index = 0

  const strongConnect = node => {
    indices.set(node, index)
    lowlinks.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)

    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next)
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)))
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)))
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const component = []
      let current = null
      do {
        current = stack.pop()
        onStack.delete(current)
        component.push(current)
      } while (current !== node)
      components.push(component)
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  return components
    .filter(component => component.length > 1)
    .map(component => {
      const memberSet = new Set(component)
      const edge = component
        .flatMap(file => edgesByFile.get(file) ?? [])
        .find(candidate => candidate.kind === 'runtime' && memberSet.has(candidate.toFile))
      return createViolation({
        ruleId: 'architecture.fileRuntimeCycle',
        severity,
        file: relativeByAbsolute.get(edge?.fromFile ?? component[0]),
        line: edge?.line ?? 1,
        found: component
          .map(file => relativeByAbsolute.get(file))
          .sort()
          .join(' -> '),
        expected: 'Runtime import graph should be acyclic at file level.',
        message: 'Runtime file-level cycle detected.',
        doc: 'docs/architecture/ARCHITECTURE.md#5-依赖规则',
      })
    })
}

function findTextViolations(sourceByFile, relativeByAbsolute, config) {
  const violations = []
  for (const rule of config.checks?.forbiddenText ?? []) {
    const pattern = new RegExp(rule.pattern)
    for (const [filePath, source] of sourceByFile) {
      const relativePath = relativeByAbsolute.get(filePath)
      if (matchesAnyPattern(relativePath, rule.allowedPatterns ?? [])) {
        continue
      }
      source.split(/\r?\n/).forEach((line, index) => {
        if (pattern.test(line)) {
          violations.push(
            createViolation({
              ruleId: rule.id,
              severity: rule.severity,
              file: relativePath,
              line: index + 1,
              found: line.trim(),
              expected:
                'Route this access through an explicit boundary adapter or add a documented allowlist path.',
              message: 'Forbidden boundary global usage detected.',
              doc: rule.doc,
            }),
          )
        }
      })
    }
  }
  return violations
}

export async function loadArchitectureConfig(configPath = defaultArchitectureRulesPath) {
  return JSON.parse(await readFile(configPath, 'utf8'))
}

export async function runArchitectureAudit(options = {}) {
  const root = resolve(options.root ?? process.cwd())
  const config = options.config ?? (await loadArchitectureConfig(options.configPath))
  const files = await collectSourceFiles(root, config)
  const relativeByAbsolute = new Map(files.map(file => [file, toRelativeProjectPath(root, file)]))
  const sourceByFile = new Map()
  const edgesByFile = new Map()
  const allowedLayers = buildAllowedLayerMap(config)
  const violations = []

  const fileAnalyses = await Promise.all(
    files.map(async filePath => {
      const source = await readFile(filePath, 'utf8')
      const relativePath = relativeByAbsolute.get(filePath)
      const fromLayer = classifyLayer(relativePath, config)
      const edges = readImportEdgesFromSource(filePath, source).map(edge => {
        const toFile = resolveInternalSpecifier(root, filePath, edge.specifier, config)
        const toRelativePath = toFile ? toRelativeProjectPath(root, toFile) : null
        return {
          ...edge,
          fromFile: filePath,
          toFile,
          fromLayer,
          toLayer: toRelativePath ? classifyLayer(toRelativePath, config) : null,
        }
      })
      const fileViolations = []

      for (const rule of config.checks?.forbiddenImportSpecifiers ?? []) {
        if (!fromLayer || !rule.fromLayers.includes(fromLayer)) {
          continue
        }
        for (const edge of edges) {
          if (
            shouldIgnoreForbiddenImportEdge(edge, rule) ||
            !specifierMatchesRule(edge.specifier, rule)
          ) {
            continue
          }
          fileViolations.push(
            createViolation({
              ruleId: rule.id,
              severity: rule.severity,
              file: relativePath,
              line: edge.line,
              found: edge.specifier,
              expected: 'Move the dependency behind an inward-facing port or a boundary adapter.',
              message: 'Forbidden import specifier for this architecture layer.',
              doc: rule.doc,
            }),
          )
        }
      }

      const layerCheck = config.checks?.layerDependencies
      if (layerCheck && fromLayer) {
        for (const edge of edges) {
          if (!edge.toLayer || (layerCheck.ignoreTypeOnly && edge.kind === 'type')) {
            continue
          }
          const allowedTargets = allowedLayers.get(fromLayer) ?? new Set([fromLayer])
          if (!allowedTargets.has(edge.toLayer)) {
            fileViolations.push(
              createViolation({
                ruleId: 'architecture.layerDependency',
                severity: layerCheck.severity,
                file: relativePath,
                line: edge.line,
                found: `${fromLayer} -> ${edge.toLayer} (${edge.specifier})`,
                expected: `${fromLayer} may depend on: ${[...allowedTargets].join(', ')}`,
                message:
                  'Import crosses an architecture layer boundary not allowed by the rule config.',
                doc: layerCheck.doc,
              }),
            )
          }
        }
      }

      return {
        filePath,
        source,
        edges,
        violations: fileViolations,
      }
    }),
  )

  for (const analysis of fileAnalyses) {
    sourceByFile.set(analysis.filePath, analysis.source)
    edgesByFile.set(analysis.filePath, analysis.edges)
    violations.push(...analysis.violations)
  }

  violations.push(
    ...findRuntimeCycleViolations(
      edgesByFile,
      relativeByAbsolute,
      config.checks?.fileRuntimeCycles?.severity ?? 'error',
    ),
    ...findTextViolations(sourceByFile, relativeByAbsolute, config),
  )

  violations.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === 'error' ? -1 : 1
    }
    return `${left.file}:${left.line}:${left.ruleId}`.localeCompare(
      `${right.file}:${right.line}:${right.ruleId}`,
    )
  })

  return {
    root,
    filesAnalyzed: files.length,
    summary: {
      errors: violations.filter(violation => violation.severity === 'error').length,
      warnings: violations.filter(violation => violation.severity === 'warn').length,
      violations: violations.length,
    },
    violations,
  }
}

export function formatArchitectureReport(report) {
  const lines = [
    `Architecture audit: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.filesAnalyzed} file(s) analyzed.`,
  ]
  for (const violation of report.violations) {
    lines.push(
      `[${violation.severity}] ${violation.ruleId}: ${violation.message}`,
      `  at ${violation.file}:${violation.line}`,
    )
    if (violation.found) {
      lines.push(`  found: ${violation.found}`)
    }
    if (violation.expected) {
      lines.push(`  expected: ${violation.expected}`)
    }
    if (violation.doc) {
      lines.push(`  doc: ${violation.doc}`)
    }
  }
  return `${lines.join('\n')}\n`
}
