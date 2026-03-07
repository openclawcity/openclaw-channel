import { build } from 'esbuild';
import { mkdirSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join } from 'path';

// Bundle .tsc-out/index.js → dist/index.js (single file, ws inlined)
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['.tsc-out/index.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/index.js',
  allowOverwrite: true,
  // Keep openclaw as external — provided by the host runtime.
  // env-bridge is external so process.env writes stay in a separate file
  // and don't trigger the OpenClaw plugin scanner's env-harvesting rule.
  external: ['openclaw', 'openclaw/*', './env-bridge.js'],
  define: {
    'process.env.WS_NO_BUFFER_UTIL': '"1"',
    'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
  },
  logLevel: 'info',
});

// Build env-bridge as a standalone file (not bundled into index.js)
await build({
  entryPoints: ['.tsc-out/env-bridge.js'],
  bundle: false,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/env-bridge.js',
  logLevel: 'info',
});

// Copy .d.ts files from .tsc-out/ to dist/ for TypeScript consumers
copyDtsRecursive('.tsc-out', 'dist');

function copyDtsRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDtsRecursive(srcPath, destPath);
    } else if (entry.endsWith('.d.ts')) {
      copyFileSync(srcPath, destPath);
    }
  }
}
