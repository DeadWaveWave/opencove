function assertAllowedEdgeReasons(config) {
  const edges = config.checks?.layerDependencies?.allowedEdges ?? []
  edges.forEach((edge, index) => {
    if (typeof edge.reason !== 'string' || edge.reason.trim() === '') {
      throw new Error(
        `checks.layerDependencies.allowedEdges[${index}] (${(edge.fromPatterns ?? []).join(', ')}) must have a non-empty "reason".`,
      )
    }
  })
}

function assertSeverities(config) {
  const checks = config.checks ?? {}
  const configured = [
    ['checks.layerDependencies', checks.layerDependencies, true],
    ['checks.fileRuntimeCycles', checks.fileRuntimeCycles, false],
    ['checks.rendererBridge', checks.rendererBridge, true],
    ['checks.sqliteTransactions', checks.sqliteTransactions, true],
    ...(checks.forbiddenImportSpecifiers ?? []).map((rule, index) => [
      `checks.forbiddenImportSpecifiers[${index}] (${rule.id})`,
      rule,
      true,
    ]),
    ...(checks.forbiddenText ?? []).map((rule, index) => [
      `checks.forbiddenText[${index}] (${rule.id})`,
      rule,
      true,
    ]),
  ]
  for (const [name, rule, required] of configured) {
    if (!rule || (rule.severity === undefined && !required)) {
      continue
    }
    if (rule.severity !== 'warn' && rule.severity !== 'error') {
      throw new Error(
        `${name}.severity must be exactly "warn" or "error", got ${JSON.stringify(rule.severity)}.`,
      )
    }
  }
}

export function assertArchitectureChecksConfig(config) {
  assertSeverities(config)
  assertAllowedEdgeReasons(config)
  for (const entry of config.checks?.sqliteTransactions?.readOnly ?? []) {
    if (!entry.file || !entry.function || !entry.reason?.trim()) {
      throw new Error('SQLite read-only exceptions require a file, function and reason.')
    }
  }
}
