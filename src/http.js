// MCP over HTTP (Streamable HTTP), for agents that can only reach a URL — ChatGPT connectors, hosted agents.
// The endpoint is /mcp/<secret>: anyone with the full URL can read and write this memory, so keep it private.

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Store } from './store.js';
import { createMcpServer } from './mcp.js';

/** The per-device secret in the endpoint path (kept in local.json, never synced). */
export function serveToken(store, { rotate = false } = {}) {
  let token = store.getLocal().serveToken;
  if (!token || rotate) {
    token = crypto.randomBytes(24).toString('base64url');
    store.setLocal({ serveToken: token });
  }
  return token;
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Start the HTTP MCP server. Resolves to { server, port, path, close }. */
export async function startHttpServer({ store = new Store(), port = 8787, host = '127.0.0.1', token } = {}) {
  token = token || serveToken(store);
  const path = `/mcp/${token}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/health') return json(res, 200, { ok: true, name: 'omnicontext' });
    const given = Buffer.from(url.pathname.replace(/\/$/, ''));
    const want = Buffer.from(path);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });

    // Stateless: a fresh server + transport per request, all sharing one store.
    // Stateless requests carry no MCP client info, so name the agent from its User-Agent.
    const ua = String(req.headers['user-agent'] || '');
    const { server: mcp } = createMcpServer(store, { agent: /openai|chatgpt/i.test(ua) ? 'ChatGPT' : 'HTTP client' });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      mcp.close();
    });
    try {
      const raw = await readBody(req);
      await mcp.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    } catch (e) {
      if (!res.headersSent) json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: String(e.message || e) }, id: null });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return { server, port: server.address().port, path, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Expose a local port through a Cloudflare quick tunnel (needs `cloudflared` on PATH).
 * Resolves to { url, child } once the public https URL is known.
 */
export function startTunnel(port, { useNpx = false } = {}) {
  const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
  return new Promise((resolve, reject) => {
    let child;
    try {
      // Without cloudflared on PATH, the `cloudflared` npm package downloads the binary on first use.
      child = useNpx
        ? spawn('npx', ['-y', 'cloudflared', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' })
        : spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    const timer = setTimeout(() => reject(new Error('cloudflared did not report a URL within 90s')), 90000);
    const scan = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], child });
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', (e) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT' && !useNpx) return startTunnel(port, { useNpx: true }).then(resolve, reject);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (${code})`));
    });
  });
}
