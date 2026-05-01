#!/usr/bin/env node

import { runStandaloneAssetBuild } from './lib/standalone-asset-build.mjs'

const result = runStandaloneAssetBuild()
process.exit(result.status ?? 1)
