#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validatePullRequestBody, validateTemplateStructure } from './lib/pr-template-check.mjs'

function readPullRequestBody() {
  if (process.argv.length > 2) {
    return readFileSync(process.argv[2], 'utf8')
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

const validationErrors = validatePullRequestBody(readPullRequestBody())

if (validationErrors.length === 0) {
  process.stdout.write('PR description matches the required template structure.\n')
  process.exit(0)
}

process.stderr.write('PR description does not satisfy .github/pull_request_template.md:\n')
for (const error of validationErrors) {
  process.stderr.write(`- ${error}\n`)
}
process.stderr.write(
  'Update the PR body to complete the required sections and change classification.\n',
)
process.exit(1)
