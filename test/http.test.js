import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.js';
import { startHttpServer, serveToken } from '../src/http.js';

test('HTTP MCP: secret path, tools work, handoff tagged ChatGPT', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-http-')));
  store.setLocal({ autoSync: false });
  const srv = await startHttpServer({ store, port: 0 });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    assert.equal((await fetch(`${base}/mcp/wrong`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${base}${srv.path}`)).status, 405);

    const client = new Client({ name: 'openai-mcp', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${srv.path}`), { requestInit: { headers: { 'user-agent': 'openai-mcp/1.0.0' } } }));
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'get_context'));
    await client.callTool({ name: 'remember', arguments: { fact: 'Uses ChatGPT too' } });
    await client.callTool({ name: 'save_handoff', arguments: { title: 'From ChatGPT', summary: 's' } });
    await client.close();

    assert.match(store.getProfile(), /Uses ChatGPT too/);
    assert.equal(store.listHandoffs()[0].agent, 'ChatGPT');
    assert.equal(serveToken(store), srv.path.split('/').pop());
  } finally {
    await srv.close();
  }
});
