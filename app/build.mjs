// Bundle the Electron main process together with the shared OmniContext core (../src).
import { build } from 'esbuild';

await build({
  entryPoints: ['main.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/main.cjs',
  external: ['electron'],
  logLevel: 'info',
});
await build({
  entryPoints: ['preload.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload.cjs',
  external: ['electron'],
  logLevel: 'info',
});
