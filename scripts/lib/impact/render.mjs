// Human-readable output of an impact report.
import { QUERY_MIN_CONFIDENCE, QUERY_MIN_SUPPORT, STALE_AFTER_DAYS } from './cochange.mjs'

const IMPORTERS_SHOWN = 8
const TESTS_SHOWN = 3
const BRIEF_PARTNERS_SHOWN = 10

const LINK_NOTES = {
  'partner-imports-file': 'imports it',
  'file-imports-partner': 'imported by it',
  both: 'imports each other',
  null: 'no import link',
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

function describeSource(cochange) {
  const { kind, throughCommit, throughDate, ageDays } = cochange.source
  const label = kind === 'live' ? 'live co-change from local history' : 'co-change index'
  return `${label} through ${throughCommit.slice(0, 8)} (${throughDate}, ${plural(ageDays, 'day')} old)`
}

function describeInput(report) {
  const base = report.input.base ? ` ${report.input.base}` : ''
  return `Impact of ${plural(report.input.files.length, 'file')} (${report.input.mode}${base})`
}

function describeAreas(report) {
  return report.areas
    .map(entry => {
      const layers = Object.entries(entry.layers)
        .map(([layer, count]) => `${layer} (${count})`)
        .join(', ')
      return `${entry.area}: ${layers || `files (${entry.files.length})`}`
    })
    .join('; ')
}

function relativeToArea(file, area) {
  const prefixes = [`src/${area}/`, `${area}/`, 'src/']
  const prefix = prefixes.find(candidate => file.startsWith(candidate))
  return prefix ? file.slice(prefix.length) : file
}

function formatImporters(file, entry, indent) {
  const areas = Object.entries(entry.byArea).sort((a, b) => b[1].length - a[1].length)
  const total = areas.reduce((sum, [, list]) => sum + list.length, 0)
  const lines = [
    `${indent}${file}: ${plural(total, 'importer')} in ${plural(areas.length, 'area')}`,
  ]
  let quota = IMPORTERS_SHOWN
  for (const [area, list] of areas) {
    const shown = list.slice(0, quota)
    quota -= shown.length
    const names = shown.map(item => relativeToArea(item.file, area))
    const rest = list.length - shown.length
    if (rest > 0) {
      names.push(`+${rest}`)
    }
    lines.push(`${indent}  ${area} (${list.length})  ${names.join(', ')}`)
  }
  return lines
}

function formatMissing(missing) {
  const files = [...new Set(missing.map(item => item.file))]
  const lines = []
  for (const file of files) {
    if (files.length > 1) {
      lines.push(`  ${file}`)
    }
    for (const item of missing.filter(entry => entry.file === file)) {
      const percent = `${Math.round(item.confidence * 100)}%`
      const tag = item.alwaysTogether
        ? '; always together: candidate for a single generated source'
        : ''
      lines.push(
        `  ${files.length > 1 ? '  ' : ''}${item.partner}  ${item.together}/${item.fileChanges}  ${percent}  ${LINK_NOTES[item.importLink]}${tag}`,
      )
    }
  }
  return lines
}

function formatTests(tests) {
  const shown = tests.slice(0, TESTS_SHOWN)
  const rest = tests.length - shown.length
  return `${tests.length}${tests.length > 0 ? ` (${[...shown, ...(rest > 0 ? [`+${rest}`] : [])].join(', ')})` : ''}`
}

function formatE2E(report) {
  const names = report.e2e.groups.map(group =>
    group.id === 'expanded' ? 'expanded (unmapped, deleted or configuration path)' : group.id,
  )
  return names.length > 0 ? names.join(', ') : 'none'
}

function staleLines(report) {
  const { source } = report.cochange
  return source.stale
    ? [
        `WARNING: the co-change index is ${source.ageDays} days old (over ${STALE_AFTER_DAYS}); a maintainer should run \`pnpm impact:index\`.`,
      ]
    : []
}

export function renderBrief(report) {
  const { missing, noHistory } = report.cochange
  const partners = [...new Set(missing.map(item => item.partner))]
  const lines = [`${describeInput(report)} · ${describeSource(report.cochange)}`]
  lines.push(`Co-change partners missing: ${partners.length}`)
  for (const item of missing.slice(0, BRIEF_PARTNERS_SHOWN)) {
    lines.push(`  ${item.partner}  ${item.together}/${item.fileChanges}  (with ${item.file})`)
  }
  if (missing.length > BRIEF_PARTNERS_SHOWN) {
    lines.push(`  +${missing.length - BRIEF_PARTNERS_SHOWN} more; run \`pnpm impact --staged\``)
  }
  lines.push(
    `Related tests: ${report.tests.length} · Quick E2E groups: ${report.e2e.groups.map(g => g.id).join(', ') || 'none'}`,
    `Files without co-change history: ${noHistory.length}`,
    ...staleLines(report),
  )
  return `${lines.join('\n')}\n`
}

export function renderHuman(report) {
  const { cochange } = report
  const lines = [`${describeInput(report)} · ${describeSource(cochange)}`]
  lines.push(`Areas and layers   ${describeAreas(report)}`)

  const importerFiles = Object.keys(report.importers)
  if (importerFiles.length === 0) {
    lines.push('Imported by        no source importers')
  } else {
    lines.push('Imported by')
    for (const file of importerFiles) {
      lines.push(...formatImporters(file, report.importers[file], '  '))
    }
  }

  lines.push(
    `Usually changed together, missing here (support ≥${QUERY_MIN_SUPPORT}, confidence ≥${QUERY_MIN_CONFIDENCE * 100}%)`,
  )
  lines.push(...(cochange.missing.length > 0 ? formatMissing(cochange.missing) : ['  none']))
  if (cochange.noHistory.length > 0) {
    lines.push(`No co-change history for ${plural(cochange.noHistory.length, 'file')}`)
    lines.push(
      `  ${cochange.noHistory.slice(0, IMPORTERS_SHOWN).join(', ')}${cochange.noHistory.length > IMPORTERS_SHOWN ? `, +${cochange.noHistory.length - IMPORTERS_SHOWN}` : ''}`,
    )
  }
  if (cochange.droppedStalePaths.length > 0) {
    lines.push(
      `Dropped ${plural(cochange.droppedStalePaths.length, 'partner')} whose paths no longer exist`,
    )
  }
  lines.push(`Related tests      ${formatTests(report.tests)}`)
  lines.push(`Quick E2E groups   ${formatE2E(report)}`)
  lines.push(...staleLines(report))
  lines.push(report.limits[0])
  return `${lines.join('\n')}\n`
}
