import { CO_CHANGE_HEADING, validatePartnerSection } from './impact/partner-section.mjs'
import { RATCHET_RISES_HEADING, validateRiseSection } from './ratchet.mjs'

const REQUIRED_TOP_LEVEL_HEADINGS = [
  '## 💡 Change Scope',
  '## 📝 What Does This PR Do?',
  '## 🏗️ Large Change Spec (Required if "Large Change" is checked)',
  CO_CHANGE_HEADING,
  '## ✅ Delivery & Compliance Checklist',
]

const CHANGE_SCOPE_LABELS = {
  small: 'Small Change',
  large: 'Large Change',
}

const LARGE_CHANGE_SUBSECTIONS = [
  '**1. Context & Business Logic**',
  '**2. State Ownership & Invariants**',
  '**3. Verification Plan & Regression Layer**',
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n?/g, '\n')
}

// An unterminated comment hides everything after it, as it does when GitHub renders the body.
function stripHtmlComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
}

function splitTopLevelSections(markdown) {
  const lines = markdown.split('\n')
  const sections = new Map()
  let currentHeading = null
  let currentLines = []

  const flush = () => {
    if (currentHeading) {
      sections.set(currentHeading, currentLines.join('\n').trim())
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('## ')) {
      flush()
      currentHeading = line.trim()
      currentLines = []
      continue
    }

    if (currentHeading) {
      currentLines.push(rawLine)
    }
  }

  flush()
  return sections
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

// Keeps only what GitHub renders as description text: removes fenced code blocks and HTML
// comments in one pass over the lines, so each hides the other's markers. A `<!--` inside a fence
// is literal text and must not swallow the body after the fence, and a fence marker inside a
// comment is not a fence. Running one removal first would get one of the two wrong.
function stripFencesAndComments(markdown) {
  const out = []
  let fence = null
  let inComment = false
  for (const line of markdown.split('\n')) {
    let text = line
    if (fence) {
      const close = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}\\s*$`).exec(line)
      if (close) {
        fence = null
      }
      continue
    }
    if (inComment) {
      const end = text.indexOf('-->')
      if (end === -1) {
        continue
      }
      inComment = false
      text = text.slice(end + 3)
    } else {
      const open = FENCE_OPEN.exec(text)
      if (open) {
        fence = open[1]
        continue
      }
    }
    let kept = ''
    while (text.length > 0) {
      const start = text.indexOf('<!--')
      if (start === -1) {
        kept += text
        break
      }
      kept += text.slice(0, start)
      const end = text.indexOf('-->', start + 4)
      if (end === -1) {
        inComment = true
        break
      }
      text = text.slice(end + 3)
    }
    out.push(kept)
  }
  return out.join('\n')
}

function hasMeaningfulContent(markdown) {
  const content = stripHtmlComments(normalizeMarkdown(markdown))

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .some(line => line !== '---')
}

function resolveChecklistState(sectionBody, label) {
  const pattern = new RegExp(`^- \\[([ xX])\\]\\s+\\*\\*${escapeRegExp(label)}\\*\\*:`, 'm')
  const match = pattern.exec(sectionBody)

  if (!match) {
    return null
  }

  return match[1].toLowerCase() === 'x'
}

function splitNamedSubsections(sectionBody, labels) {
  const lines = normalizeMarkdown(sectionBody).split('\n')
  const sections = new Map()
  let currentLabel = null
  let currentLines = []

  const flush = () => {
    if (currentLabel) {
      sections.set(currentLabel, currentLines.join('\n').trim())
    }
  }

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim()
    const matchedLabel = labels.find(label => trimmedLine.startsWith(label))

    if (matchedLabel) {
      flush()
      currentLabel = matchedLabel
      const remainder = trimmedLine.slice(matchedLabel.length).replace(/^[:\s-]+/, '')
      currentLines = remainder.length > 0 ? [remainder] : []
      continue
    }

    if (currentLabel) {
      currentLines.push(rawLine)
    }
  }

  flush()
  return sections
}

export function validateTemplateStructure(templateMarkdown) {
  const normalizedTemplate = normalizeMarkdown(templateMarkdown)
  const sections = splitTopLevelSections(normalizedTemplate)
  const errors = []

  for (const heading of REQUIRED_TOP_LEVEL_HEADINGS) {
    if (!sections.has(heading)) {
      errors.push(`Template is missing required heading: ${heading}`)
    }
  }

  const changeScopeSection = sections.get(REQUIRED_TOP_LEVEL_HEADINGS[0]) ?? ''
  for (const label of Object.values(CHANGE_SCOPE_LABELS)) {
    if (resolveChecklistState(changeScopeSection, label) === null) {
      errors.push(`Template is missing required scope checkbox: ${label}`)
    }
  }

  const largeChangeSection = sections.get(REQUIRED_TOP_LEVEL_HEADINGS[2]) ?? ''
  const largeChangeSubsections = splitNamedSubsections(largeChangeSection, LARGE_CHANGE_SUBSECTIONS)

  for (const label of LARGE_CHANGE_SUBSECTIONS) {
    if (!largeChangeSubsections.has(label)) {
      errors.push(`Template is missing required Large Change subsection: ${label}`)
    }
  }

  return errors
}

// `missingPartners` are the co-change partners the diff leaves untouched, from
// `findMissingPartners`. Without them (no diff known) the section only has to have content.
// `ratchetRises` are the rises and retirements of ratchet baselines from the merge base to the
// head, from `collectRatchetRises`. Without them (no diff known) the rises section is not checked.
export function validatePullRequestBody(
  prBody,
  { missingPartners = null, ratchetRises = null } = {},
) {
  // Only what GitHub renders counts: a section inside a comment or a code fence is not a section.
  const normalizedBody = stripFencesAndComments(normalizeMarkdown(prBody ?? ''))
  const sections = splitTopLevelSections(normalizedBody)
  const errors = []

  if (normalizedBody.trim().length === 0) {
    errors.push('Pull request description is empty.')
    return errors
  }

  for (const heading of REQUIRED_TOP_LEVEL_HEADINGS) {
    if (!sections.has(heading)) {
      errors.push(`Pull request description is missing required section: ${heading}`)
    }
  }

  const changeScopeSection = sections.get(REQUIRED_TOP_LEVEL_HEADINGS[0]) ?? ''
  const isSmallSelected = resolveChecklistState(changeScopeSection, CHANGE_SCOPE_LABELS.small)
  const isLargeSelected = resolveChecklistState(changeScopeSection, CHANGE_SCOPE_LABELS.large)

  if (isSmallSelected === null || isLargeSelected === null) {
    errors.push('Change Scope must include both Small Change and Large Change checkboxes.')
  } else if (isSmallSelected === isLargeSelected) {
    errors.push('Change Scope must select exactly one of Small Change or Large Change.')
  }

  const summarySection = sections.get(REQUIRED_TOP_LEVEL_HEADINGS[1]) ?? ''
  if (!hasMeaningfulContent(summarySection)) {
    errors.push('What Does This PR Do? must contain a meaningful description.')
  }

  if (isLargeSelected) {
    const largeChangeSection = sections.get(REQUIRED_TOP_LEVEL_HEADINGS[2]) ?? ''
    const subsections = splitNamedSubsections(largeChangeSection, LARGE_CHANGE_SUBSECTIONS)

    for (const label of LARGE_CHANGE_SUBSECTIONS) {
      const subsectionContent = subsections.get(label) ?? ''
      if (!hasMeaningfulContent(subsectionContent)) {
        errors.push(`Large Change Spec requires content for ${label}.`)
      }
    }
  }

  if (sections.has(CO_CHANGE_HEADING)) {
    const coChangeSection = sections.get(CO_CHANGE_HEADING)
    if (missingPartners) {
      errors.push(...validatePartnerSection(coChangeSection, missingPartners))
    } else if (!hasMeaningfulContent(coChangeSection)) {
      errors.push(`${CO_CHANGE_HEADING} must contain content.`)
    }
  }

  if (ratchetRises) {
    if (sections.has(RATCHET_RISES_HEADING)) {
      errors.push(...validateRiseSection(sections.get(RATCHET_RISES_HEADING), ratchetRises))
    } else if (ratchetRises.length > 0) {
      errors.push(
        `${RATCHET_RISES_HEADING} is required: ${ratchetRises.length} rise or retirement of a ratchet baseline total against the merge base needs one line each.`,
      )
    }
  }

  return errors
}
