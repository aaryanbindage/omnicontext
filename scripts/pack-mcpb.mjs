// Packs dist/omnicontext.mjs into omnicontext.mcpb (one-click install for Claude Desktop).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-mcpb-'));
fs.mkdirSync(path.join(stage, 'dist'));
for (const f of ['manifest.json', 'icon.png', 'LICENSE', 'dist/omnicontext.mjs']) fs.copyFileSync(f, path.join(stage, f));
execSync(`npx -y @anthropic-ai/mcpb@2.1.2 pack "${stage}" omnicontext.mcpb`, { stdio: 'inherit' });
