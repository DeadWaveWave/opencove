#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..')
const UI_STYLE_ROOT = 'src/app/renderer'
const BASE_TOKEN_FILE = 'src/app/renderer/styles/base.css'
const THEME_DIRECTORY = 'src/app/renderer/styles/themes/'

const TOKEN_DECLARATION_PATTERN = /(--cove-[a-z0-9_-]+)\s*:/gi
const TOKEN_USAGE_PATTERN = /var\(\s*(--cove-[a-z0-9_-]+)/gi
const RAW_COLOR_PATTERN =
  /(?:#[0-9a-f]{8}|#[0-9a-f]{6}|#[0-9a-f]{4}|#[0-9a-f]{3})(?![0-9a-f])|rgba?\s*\([^)]*\)/gi
const THEME_BRANCH_PATTERN = /\[\s*data-cove-theme(?:-id)?(?:\s*[~|^$*]?=|\s*\])/gi

function colorSet(colors) {
  return new Set(colors.map(canonicalizeRawColor))
}

// These colors mirror the third-party OpenCode terminal palette. They are part
// of the terminal-provider presentation protocol rather than OpenCove chrome.
const OPENCODE_TERMINAL_COLORS = colorSet([
  'rgba(107, 138, 236, 0.65)',
  'rgba(104, 137, 226, 0.45)',
  'rgba(0, 0, 0, 0.45)',
  'rgba(153, 223, 255, 0.88)',
  'rgba(168, 233, 255, 0.42)',
  'rgba(0, 0, 0, 0.52)',
  'rgba(7, 12, 24, 0.9)',
  'rgba(18, 28, 50, 0.96)',
  '#0a0f1d',
  '#d6e4ff',
  'rgba(94, 156, 255, 0.35)',
  'rgba(255, 255, 255, 0.92)',
  'rgba(255, 255, 255, 0.6)',
  'rgba(255, 255, 255, 0.4)',
  'rgba(255, 255, 255, 0.12)',
  'rgba(255, 255, 255, 0.08)',
  'rgba(255, 255, 255, 0.04)',
])

// Provider icon accents identify external agent brands. Only these audited
// constants are exempt; other colors in the same component still need tokens.
const AGENT_PROVIDER_BRAND_COLORS = colorSet([
  'rgba(148, 163, 184, 0.92)',
  'rgba(217, 119, 87, 0.96)',
  'rgba(125, 211, 252, 0.96)',
  'rgba(96, 165, 250, 0.96)',
  'rgba(196, 181, 253, 0.96)',
])

export const DEFAULT_RAW_COLOR_ALLOWLIST = new Map([
  ['src/app/renderer/styles/terminal-node.theme-opencode.css', OPENCODE_TERMINAL_COLORS],
  ['src/app/renderer/styles/workspace-agent-item.css', AGENT_PROVIDER_BRAND_COLORS],
])

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/')
}

function canonicalizeRawColor(color) {
  return color.toLowerCase().replace(/\s+/g, ' ').trim()
}

function stripCommentsPreservingLocations(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\r\n]/g, ' '))
}

function isTokenSource(filePath) {
  return filePath === BASE_TOKEN_FILE || filePath.startsWith(THEME_DIRECTORY)
}

function locationAt(content, index) {
  const prefix = content.slice(0, index)
  const line = prefix.split(/\r\n|\r|\n/).length
  const lineStart = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r')) + 1
  const lineEndMatch = content.slice(index).search(/\r|\n/)
  const lineEnd = lineEndMatch === -1 ? content.length : index + lineEndMatch

  return {
    line,
    column: index - lineStart + 1,
    excerpt: content.slice(lineStart, lineEnd).trim(),
  }
}

function makeViolation({ file, content, index, rule, message }) {
  return {
    file,
    rule,
    message,
    ...locationAt(content, index),
  }
}

function isAllowedRawColor(filePath, rawColor, allowlist) {
  const allowedColors = allowlist.get(filePath)
  return allowedColors?.has(canonicalizeRawColor(rawColor)) ?? false
}

export function checkUiStyleFiles(files, { rawColorAllowlist = DEFAULT_RAW_COLOR_ALLOWLIST } = {}) {
  const normalizedFiles = files.map(file => {
    const content = file.content ?? ''
    return {
      path: normalizePath(file.path),
      content,
      source: stripCommentsPreservingLocations(content),
    }
  })
  const declaredTokens = new Set()
  const tokenUsages = []
  const violations = []

  for (const file of normalizedFiles) {
    for (const match of file.source.matchAll(TOKEN_DECLARATION_PATTERN)) {
      declaredTokens.add(match[1].toLowerCase())
    }

    for (const match of file.source.matchAll(TOKEN_USAGE_PATTERN)) {
      tokenUsages.push({ file, index: match.index, token: match[1].toLowerCase() })
    }

    if (isTokenSource(file.path)) {
      continue
    }

    for (const match of file.source.matchAll(RAW_COLOR_PATTERN)) {
      if (isAllowedRawColor(file.path, match[0], rawColorAllowlist)) {
        continue
      }

      violations.push(
        makeViolation({
          file: file.path,
          content: file.content,
          index: match.index,
          rule: 'raw-color',
          message: `Replace raw color \`${match[0]}\` with a declared \`--cove-*\` token.`,
        }),
      )
    }

    for (const match of file.source.matchAll(THEME_BRANCH_PATTERN)) {
      violations.push(
        makeViolation({
          file: file.path,
          content: file.content,
          index: match.index,
          rule: 'component-theme-branch',
          message: 'Move `data-cove-theme` branching into base.css or styles/themes/**.',
        }),
      )
    }
  }

  for (const usage of tokenUsages) {
    if (declaredTokens.has(usage.token)) {
      continue
    }

    violations.push(
      makeViolation({
        file: usage.file.path,
        content: usage.file.content,
        index: usage.index,
        rule: 'undeclared-token',
        message: `Declare \`${usage.token}\` before using it.`,
      }),
    )
  }

  return violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  )
}

function collectCssFiles(directory, repoRoot, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      collectCssFiles(absolutePath, repoRoot, files)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.css')) {
      continue
    }

    files.push({
      path: normalizePath(relative(repoRoot, absolutePath)),
      content: readFileSync(absolutePath, 'utf8'),
    })
  }
}

export function readUiStyleFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const files = []
  collectCssFiles(resolve(repoRoot, UI_STYLE_ROOT), repoRoot, files)
  return files
}

export function formatUiStyleViolations(violations) {
  if (violations.length === 0) {
    return ''
  }

  const lines = [`[ui-style-check] Found ${violations.length} UI style violation(s):`]
  for (const violation of violations) {
    lines.push(
      `- ${violation.file}:${violation.line}:${violation.column} [${violation.rule}]`,
      `  ${violation.message}`,
      `  ${violation.excerpt}`,
    )
  }
  lines.push('', 'See docs/ui/README.md for the token and theme rules.')
  return `${lines.join('\n')}\n`
}

export function runUiStyleCheck({ repoRoot = DEFAULT_REPO_ROOT, stderr = process.stderr } = {}) {
  const violations = checkUiStyleFiles(readUiStyleFiles(repoRoot))
  if (violations.length === 0) {
    return 0
  }

  stderr.write(formatUiStyleViolations(violations))
  return 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  process.exitCode = runUiStyleCheck()
}
