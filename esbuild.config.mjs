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
  // Keep openclaw as external — provided by the host runtime
  external: ['openclaw', 'openclaw/*'],
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
