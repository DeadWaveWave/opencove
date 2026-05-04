const REQUIRED_TOP_LEVEL_HEADINGS = [
  '## 💡 Change Scope',
  '## 📝 What Does This PR Do?',
  '## 🏗️ Large Change Spec (Required if "Large Change" is checked)',
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

function stripHtmlComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, '')
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

export function validatePullRequestBody(prBody) {
  const normalizedBody = normalizeMarkdown(prBody ?? '')
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

  return errors
}
