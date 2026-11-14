// The pull request section that explains each co-change partner a change left untouched. Pure
// text handling; the partner list itself comes from `findMissingPartners`.

export const CO_CHANGE_HEADING = '## 🔗 Co-change partners left untouched'
export const REASON_PLACEHOLDER = '<reason>'
export const NO_PARTNERS_LINE = 'None: this change leaves no co-change partner untouched.'

/** One entry per partner: the strongest link wins when several changed files share a partner. */
export function uniquePartners(missing) {
  const best = new Map()
  for (const item of missing) {
    const current = best.get(item.partner)
    if (
      !current ||
      item.confidence > current.confidence ||
      (item.confidence === current.confidence && item.together > current.together)
    ) {
      best.set(item.partner, item)
    }
  }
  return [...best.values()].sort((a, b) => (a.partner < b.partner ? -1 : 1))
}

export function formatPartnerLine(item, reason = REASON_PLACEHOLDER) {
  return `- \`${item.partner}\` (with \`${item.file}\`, ${item.together}/${item.fileChanges}): ${reason}`
}

export function formatPrSection(missing) {
  const partners = uniquePartners(missing)
  const body = partners.length === 0 ? [NO_PARTNERS_LINE] : partners.map(p => formatPartnerLine(p))
  return `${CO_CHANGE_HEADING}\n\n${body.join('\n')}\n`
}

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

/** Maps each partner named in the section to the reason written after it. */
export function parsePartnerReasons(sectionBody) {
  const reasons = new Map()
  for (const rawLine of stripHtmlComments(sectionBody).split('\n')) {
    const match = /^\s*[-*]\s+`([^`]+)`(.*)$/.exec(rawLine)
    if (!match) {
      continue
    }
    const rest = match[2].replace(/^\s*\([^)]*\)/, '')
    const reason = /^\s*:\s*(.*)$/.exec(rest)?.[1]?.trim()
    if (reason !== undefined && !reasons.has(match[1])) {
      reasons.set(match[1], reason)
    }
  }
  return reasons
}

function hasRealReason(reason) {
  return (
    Boolean(reason) &&
    !reason.toLowerCase().includes(REASON_PLACEHOLDER) &&
    /[\p{L}\p{N}]/u.test(reason)
  )
}

/** Errors for a section body against the partners the diff leaves untouched. */
export function validatePartnerSection(sectionBody, missing) {
  const partners = uniquePartners(missing)
  const content = stripHtmlComments(sectionBody)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line !== '---')
  if (partners.length === 0) {
    return content.length > 0
      ? []
      : [`${CO_CHANGE_HEADING} must say that no partner was left untouched.`]
  }
  const reasons = parsePartnerReasons(sectionBody)
  const errors = []
  for (const item of partners) {
    if (!reasons.has(item.partner)) {
      errors.push(`Co-change partner \`${item.partner}\` (with \`${item.file}\`) is not named.`)
    } else if (!hasRealReason(reasons.get(item.partner))) {
      errors.push(`Co-change partner \`${item.partner}\` has no reason.`)
    }
  }
  return errors
}
