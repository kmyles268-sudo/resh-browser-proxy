#!/usr/bin/env node
const readline = require('readline');

const PROXY_URL = 'https://fresh-browser-proxy.onrender.com/fetch?url=';

const MANIFEST = {
  jsonrpc: "2.0",
  result: {
    name: "fresh-browser-proxy",
    version: "1.0.0",
    description: "Fetches any URL using a real headless Chromium browser — always fresh, no cache, full JS rendering.",
    tools: [
      {
        name: "fresh_fetch",
        description: "Fetch any public URL using a real headless browser. Returns clean readable text, title, final URL, fetch timestamp, and status code. Always fresh — no caching. Handles JS-rendered sites like Squarespace, React, Next.js.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full URL to fetch (e.g. https://example.com)"
            }
          },
          required: ["url"]
        }
      }
    ]
  }
};

async function freshFetch(url) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(PROXY_URL + encodeURIComponent(url));
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  if (method === 'initialize' || method === 'tools/list') {
    process.stdout.write(JSON.stringify({ ...MANIFEST, id }) + '\n');
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    if (name === 'fresh_fetch') {
      try {
        const data = await freshFetch(args.url);
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0", id,
          result: {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
          }
        }) + '\n');
      } catch (err) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0", id,
          error: { code: -32000, message: err.message }
        }) + '\n');
      }
    }
    return;
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0", id,
    error: { code: -32601, message: "Method not found" }
  }) + '\n');
});
