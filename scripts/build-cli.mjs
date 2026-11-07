import { chmod } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { build } from 'vite'

// Node 22 is the common baseline for Electron and the standalone Node runtime.
// Never execute a target-platform runtime during a cross-platform build.
await build({
  configFile: false,
  build: {
    target: 'node22',
    outDir: 'out/cli',
    emptyOutDir: true,
    minify: false,
    lib: { entry: resolve('src/app/cli/main.ts'), formats: ['es'], fileName: () => 'opencove.mjs' },
    rollupOptions: {
      external: id => !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('\0'),
      output: { inlineDynamicImports: true, banner: '#!/usr/bin/env node' },
    },
  },
})
await chmod('out/cli/opencove.mjs', 0o755)
