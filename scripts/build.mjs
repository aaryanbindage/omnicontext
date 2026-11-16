// Bundle the CLI + MCP server into one dependency-free file, so the Claude Code
// plugin can run it straight from the cloned repo (no npm install).
import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  stdin: {
    contents: "import { main } from './src/cli.js';\nmain().catch((e) => { console.error(e.message || e); process.exit(1); });",
    resolveDir: '.',
    sourcefile: 'entry.js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/omnicontext.mjs',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: 'none',
  minify: true,
  logLevel: 'info',
});
fs.chmodSync('dist/omnicontext.mjs', 0o755);
