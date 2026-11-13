#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validatePullRequestBody, validateTemplateStructure } from './lib/pr-template-check.mjs'
import { resolveBaseChanges } from './lib/impact/changes.mjs'
import { findMissingPartners, loadIndex } from './lib/impact/cochange.mjs'
import { formatPrSection } from './lib/impact/partner-section.mjs'

// Usage: check-pr-template.mjs [body.md] [--base <ref> [--head <ref>]]
// The diff for the co-change check comes from --base/--head, or from the pull request event.
function parseArguments(argv) {
  const options = { bodyFile: null, base: null, head: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if ((argument === '--base' || argument === '--head') && argv[index + 1]) {
      options[argument.slice(2)] = argv[(index += 1)]
    } else if (!argument.startsWith('--') && options.bodyFile === null) {
      options.bodyFile = argument
    } else {
      process.stderr.write(
        'Usage: node scripts/check-pr-template.mjs [body.md] [--base <ref> [--head <ref>]]\n',
      )
      process.exit(2)
    }
  }
  return options
}

const options = parseArguments(process.argv.slice(2))

function readEventPayload() {
  const eventPath = process.env['GITHUB_EVENT_PATH']?.trim()
  return eventPath ? JSON.parse(readFileSync(eventPath, 'utf8')) : null
}

function resolveDiffRange() {
  if (options.base) {
    return { base: options.base, head: options.head }
  }
  const pullRequest = readEventPayload()?.pull_request
  if (pullRequest?.base?.sha && pullRequest?.head?.sha) {
    return { base: pullRequest.base.sha, head: pullRequest.head.sha }
  }
  return null
}

function readPullRequestBody() {
  if (options.bodyFile) {
    return readFileSync(options.bodyFile, 'utf8')
  }

  const eventPath = process.env['GITHUB_EVENT_PATH']?.trim()
  if (eventPath) {
    const payload = JSON.parse(readFileSync(eventPath, 'utf8'))
    const body = payload?.pull_request?.body

    if (typeof body === 'string') {
      return body
    }

    if (body === null || body === undefined) {
      return ''
    }

    throw new Error('Expected pull_request.body in GitHub event payload to be a string.')
  }

  const body = process.env['OPENCOVE_PR_BODY']
  if (typeof body === 'string') {
    return body
  }

  throw new Error(
    'Unable to resolve PR body. Provide GITHUB_EVENT_PATH, OPENCOVE_PR_BODY, or a markdown file path.',
  )
}

const rootDir = resolve(import.meta.dirname, '..')
const templatePath = resolve(rootDir, '.github/pull_request_template.md')
const templateMarkdown = readFileSync(templatePath, 'utf8')
const templateErrors = validateTemplateStructure(templateMarkdown)

if (templateErrors.length > 0) {
  process.stderr.write(
    'PR template validator is out of sync with .github/pull_request_template.md:\n',
  )
  for (const error of templateErrors) {
    process.stderr.write(`- ${error}\n`)
  }
  process.exit(1)
}

// The co-change partners this diff leaves untouched: the same function `pnpm impact` uses.
let missingPartners = null
const diffRange = resolveDiffRange()
if (diffRange) {
  try {
    const changes = resolveBaseChanges(rootDir, diffRange.base, diffRange.head)
    missingPartners = findMissingPartners(
      loadIndex(rootDir),
      changes.map(change => change.path),
      { exists: path => existsSync(resolve(rootDir, path)) },
    ).missing
  } catch (error) {
    process.stderr.write(
      `Cannot compute co-change partners: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }
}

const validationErrors = validatePullRequestBody(readPullRequestBody(), { missingPartners })

if (validationErrors.length === 0) {
  process.stdout.write('PR description matches the required template structure.\n')
  process.exit(0)
}

process.stderr.write('PR description does not satisfy .github/pull_request_template.md:\n')
for (const error of validationErrors) {
  process.stderr.write(`- ${error}\n`)
}
if (missingPartners && missingPartners.length > 0) {
  process.stderr.write(
    '\nPaste this section into the PR body and replace each <reason> with one line saying why the\n' +
      'partner needs no change here (or "should be extracted, follow-up #N"):\n\n' +
      `${formatPrSection(missingPartners)}\n`,
  )
}
process.stderr.write(
  'Update the PR body to complete the required sections and change classification.\n',
)
process.exit(1)
