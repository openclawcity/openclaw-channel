import { build } from 'esbuild';

await build({
  entryPoints: ['dist/index.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/index.js',
  allowOverwrite: true,
  // Keep openclaw as external — provided by the host runtime
  external: ['openclaw', 'openclaw/*'],
  // ws optional native addons — not needed, suppress warnings
  logLevel: 'info',
});
