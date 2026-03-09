#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const [, , rawDirectory = '.'] = process.argv
const targetDirectory = resolve(rawDirectory)
const entries = await readdir(targetDirectory)

const lines = []

for (const entry of entries.sort()) {
  if (entry === 'SHA256SUMS.txt') {
    continue
  }

  const filePath = resolve(targetDirectory, entry)
  const info = await stat(filePath)
  if (!info.isFile()) {
    continue
  }

  const buffer = await readFile(filePath)
  const hash = createHash('sha256').update(buffer).digest('hex')
  lines.push(`${hash}  ${basename(filePath)}`)
}

if (lines.length === 0) {
  throw new Error(`No release files found in ${targetDirectory}`)
}

await writeFile(resolve(targetDirectory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
console.log(`Wrote checksums for ${lines.length} file(s) in ${targetDirectory}`)
