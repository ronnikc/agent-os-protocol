// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.AGENT_OS_WEBSITE_PORT) || 4802;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIR = __dirname;
const SAFE_DIR = DIR.endsWith(sep) ? DIR : DIR + sep;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const server = createServer((req, res) => {
  let urlPath = req.url?.split('?')[0] || '/';
  if (urlPath === '/mainnet-proof' || urlPath === '/mainnet-proof.html') {
    res.writeHead(302, { location: 'https://lobby.agent-os-protocol.com/panel/mainnet-proof.html' }).end();
    return;
  }
  if (extname(urlPath) === '.ts') {
    res.writeHead(404).end('404 Not Found');
    return;
  }
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, revision: process.env.AGENT_OS_REVISION }));
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const file = join(DIR, urlPath);
  
  // Protect against sibling path traversal, non-existent files, and directory reads (EISDIR)
  if (!file.startsWith(SAFE_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = extname(file);
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(file);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Error');
  }
});

server.listen(PORT, () => {
  console.log(`Agent OS Website preview listening on http://localhost:${PORT}`);
});
