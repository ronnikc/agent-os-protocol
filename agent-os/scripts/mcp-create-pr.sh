#!/bin/bash
# agent-os/scripts/mcp-create-pr.sh
# Create a GitHub pull request via the MCP GitHub server.
# Companion to mcp-push.sh — for environments where gh CLI is unavailable.
#
# Usage:
#   bash agent-os/scripts/mcp-create-pr.sh \
#     --head <branch-name> \
#     --base <base-branch> \
#     --title <pr-title> \
#     (--body <pr-body> | --body-file <path>)
#
# Owner/repo are auto-detected from git remote.
# Session ID and auth token are auto-detected from the environment.
#
# Body input:
#   --body <text>        Inline body. WARNING: literal "\n" in a bash double-quoted
#                        string is NOT a newline — GitHub will render it as "\n".
#                        Prefer --body-file for any multi-line body.
#   --body-file <path>   Read body from file. Preserves real newlines and avoids
#                        every class of shell-quoting/escaping bug. Preferred.
#
# Output: prints PR_URL=<url> on success (parse this to capture the URL).
#
# Examples:
#   # Inline body (single line only):
#   bash agent-os/scripts/mcp-create-pr.sh \
#     --head claude/graph-update-abc123 \
#     --base main \
#     --title "chore(graph): scheduled graph update" \
#     --body "Automated dependency graph update."
#
#   # Multi-line body via file (recommended):
#   cat > /tmp/pr-body.md <<'EOF'
#   ## Summary
#
#   Automated dependency graph update. See artifacts for details.
#   EOF
#   bash agent-os/scripts/mcp-create-pr.sh \
#     --head claude/graph-update-abc123 --base main \
#     --title "chore(graph): scheduled graph update" \
#     --body-file /tmp/pr-body.md

set -euo pipefail

# --- Parse arguments ---
HEAD=""
BASE="main"
TITLE=""
BODY=""
BODY_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --head)      HEAD="$2";      shift 2 ;;
    --base)      BASE="$2";      shift 2 ;;
    --title)     TITLE="$2";     shift 2 ;;
    --body)      BODY="$2";      shift 2 ;;
    --body-file) BODY_FILE="$2"; shift 2 ;;
    *)           echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$HEAD" || -z "$TITLE" ]]; then
  echo "Usage: mcp-create-pr.sh --head <branch> --base <base> --title <title> (--body <body> | --body-file <path>)" >&2
  exit 1
fi

if [[ -n "$BODY_FILE" ]]; then
  if [[ -n "$BODY" ]]; then
    echo "ERROR: Pass either --body or --body-file, not both" >&2
    exit 1
  fi
  if [[ ! -f "$BODY_FILE" ]]; then
    echo "ERROR: --body-file not found: $BODY_FILE" >&2
    exit 1
  fi
  BODY=$(cat "$BODY_FILE")
fi

# Guard: warn if an inline --body contains the literal two-character sequence "\n".
# This almost always means the caller used bash double-quotes expecting newlines
# (they don't expand there) — the PR body will render with visible "\n" text.
if [[ "$BODY" == *'\n'* ]]; then
  echo "WARNING: --body contains the literal sequence '\\n'. In bash double-quoted strings" >&2
  echo "         this is NOT a newline. Use --body-file for multi-line bodies." >&2
fi

# --- Auto-detect owner/repo from git remote ---
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [[ -z "$REMOTE_URL" ]]; then
  echo "ERROR: No git remote 'origin' found" >&2
  exit 1
fi
OWNER=$(echo "$REMOTE_URL" | sed -E 's#.*/([^/]+)/([^/]+?)(\.git)?$#\1#')
REPO=$(echo "$REMOTE_URL" | sed -E 's#.*/([^/]+)/([^/]+?)(\.git)?$#\2#')

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  echo "ERROR: Could not extract owner/repo from: $REMOTE_URL" >&2
  exit 1
fi

echo "=== MCP Create PR ==="
echo "Repository: $OWNER/$REPO"
echo "Head: $HEAD → Base: $BASE"
echo "Title: $TITLE"
echo ""

# --- Create Node.js script ---
PR_SCRIPT=$(mktemp /tmp/mcp-create-pr-XXXXXX.js)

cat > "$PR_SCRIPT" << 'NODEJS_EOF'
const http = require('http');
const tls = require('tls');
const fs = require('fs');

// --- Config from environment ---
const owner = process.env.MCP_OWNER;
const repo = process.env.MCP_REPO;
const head = process.env.MCP_HEAD;
const base = process.env.MCP_BASE;
const title = process.env.MCP_TITLE;
const body = process.env.MCP_BODY || '';

// --- Auto-detect session ID ---
let sessionId = '';
const ccrPattern = /cse_[a-zA-Z0-9]+/;

const envVars = Object.entries(process.env);
for (const [key, val] of envVars) {
  const match = val.match(ccrPattern);
  if (match) {
    sessionId = match[0];
    break;
  }
}

if (!sessionId) {
  try {
    const sessionDir = '/home/claude/.claude/remote';
    const files = fs.readdirSync(sessionDir);
    for (const f of files) {
      const match = f.match(ccrPattern);
      if (match) { sessionId = match[0]; break; }
    }
  } catch(e) {}
}

if (!sessionId) {
  console.error('ERROR: Could not detect CCR session ID');
  process.exit(1);
}
console.log('Session ID:', sessionId);

// --- Read auth token ---
let oauthToken;
try {
  oauthToken = fs.readFileSync('/home/claude/.claude/remote/.session_ingress_token', 'utf8').trim();
} catch(e) {
  try {
    oauthToken = fs.readFileSync('/proc/self/fd/4', 'utf8').trim();
  } catch(e2) {
    console.error('ERROR: Could not read auth token');
    process.exit(1);
  }
}
console.log('Auth token: ' + oauthToken.substring(0, 15) + '...');

// --- Transport config ---
// See agent-os/scripts/mcp-push.sh for the rationale — proxy was hardcoded
// and 60s timeout was too short. Probe the proxy (500ms), fall back to direct
// HTTPS, honour MCP_TIMEOUT_MS (default 180s).
const TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS || '180000', 10);

const javaOpts = process.env.JAVA_TOOL_OPTIONS || '';
const proxyHost = javaOpts.match(/-Dhttps\.proxyHost=([^\s]+)/)?.[1] || '21.0.0.31';
const proxyPort = parseInt(javaOpts.match(/-Dhttps\.proxyPort=([^\s]+)/)?.[1] || '15004', 10);
const proxyUser = javaOpts.match(/-Dhttps\.proxyUser=([^\s]+)/)?.[1] || '';
const proxyPass = javaOpts.match(/-Dhttps\.proxyPassword=([^\s]+)/)?.[1] || '';
const proxyConfigured = !!javaOpts.match(/-Dhttps\.proxyHost=/);

function probeProxy(host, port, probeTimeoutMs) {
  return new Promise(resolve => {
    const net = require('net');
    const sock = net.connect(port, host);
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), probeTimeoutMs);
    sock.once('connect', () => { clearTimeout(timer); finish(true); });
    sock.once('error', () => { clearTimeout(timer); finish(false); });
  });
}

// --- Build MCP request ---
const mcpBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'create_pull_request',
    arguments: { owner, repo, head, base, title, body }
  }
});

console.log(`\nMCP payload: ${mcpBody.length} bytes`);

// --- Detect MCP server ID ---
let mcpServerId = 'f88c92ac-3a8a-54d5-a9d5-a5c466aaefc2';
try {
  const mcpConfigPaths = [
    '/home/claude/.claude/remote/mcp_servers.json',
    '/home/claude/.claude/mcp_servers.json',
  ];
  for (const p of mcpConfigPaths) {
    if (fs.existsSync(p)) {
      const config = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [id, server] of Object.entries(config)) {
        if (typeof server === 'object' && (server.name === 'github' || id.includes('github'))) {
          mcpServerId = id;
          break;
        }
      }
    }
  }
} catch(e) {}

function buildHttpHead(len) {
  return [
    `POST /v2/ccr-sessions/${sessionId}/github/mcp HTTP/1.1`,
    'Host: api.anthropic.com',
    'Content-Type: application/json',
    `Content-Length: ${len}`,
    `Authorization: Bearer ${oauthToken}`,
    `X-MCP-Server-ID: ${mcpServerId}`,
    'Connection: close',
    '',
    ''
  ].join('\r\n');
}

function handleResponse(tlsSocket) {
  let data = Buffer.alloc(0);
  tlsSocket.on('data', d => { data = Buffer.concat([data, d]); });
  tlsSocket.on('end', () => {
    const str = data.toString();
    const statusLine = str.split('\r\n')[0];
    console.log('Response:', statusLine);
    const bodyIdx = str.indexOf('\r\n\r\n');
    const respBody = str.substring(bodyIdx + 4);
    if (statusLine.includes('200')) {
      const urlMatch = respBody.match(/"html_url":"(https:\/\/github\.com\/[^"]+\/pull\/\d+)"/);
      if (urlMatch) {
        console.log(`\nPR_URL=${urlMatch[1]}`);
      } else {
        const numMatch = respBody.match(/"number":(\d+)/);
        if (numMatch) {
          const prUrl = `https://github.com/${owner}/${repo}/pull/${numMatch[1]}`;
          console.log(`\nPR_URL=${prUrl}`);
        } else {
          console.log('\nSUCCESS (PR created but could not extract URL)');
          console.log('Body preview:', respBody.substring(0, 500));
        }
      }
      process.exit(0);
    } else {
      console.error('\nFAILED:', statusLine);
      console.error('Body:', respBody.substring(0, 500));
      process.exit(1);
    }
  });
}

function sendViaProxy() {
  const proxyAuth = Buffer.from(proxyUser + ':' + proxyPass).toString('base64');
  const connectReq = http.request({
    hostname: proxyHost,
    port: proxyPort,
    method: 'CONNECT',
    path: 'api.anthropic.com:443',
    headers: { 'Proxy-Authorization': 'Basic ' + proxyAuth }
  });
  connectReq.on('connect', (res, socket) => {
    if (res.statusCode !== 200) {
      console.error(`CONNECT failed: ${res.statusCode}`);
      process.exit(1);
    }
    const tlsSocket = tls.connect({ socket, servername: 'api.anthropic.com' }, () => {
      tlsSocket.write(buildHttpHead(Buffer.byteLength(mcpBody)));
      tlsSocket.write(mcpBody);
      handleResponse(tlsSocket);
    });
    tlsSocket.on('error', e => {
      console.error('TLS error:', e.message);
      process.exit(1);
    });
  });
  connectReq.on('error', e => {
    console.error('Connect error:', e.message);
    process.exit(1);
  });
  connectReq.setTimeout(TIMEOUT_MS, () => {
    console.error(`Timeout after ${TIMEOUT_MS}ms (proxy)`);
    connectReq.destroy();
    process.exit(1);
  });
  connectReq.end();
}

function sendDirect() {
  const tlsSocket = tls.connect(
    { host: 'api.anthropic.com', port: 443, servername: 'api.anthropic.com' },
    () => {
      tlsSocket.write(buildHttpHead(Buffer.byteLength(mcpBody)));
      tlsSocket.write(mcpBody);
      handleResponse(tlsSocket);
    }
  );
  tlsSocket.setTimeout(TIMEOUT_MS, () => {
    console.error(`Timeout after ${TIMEOUT_MS}ms (direct)`);
    tlsSocket.destroy();
    process.exit(1);
  });
  tlsSocket.on('error', e => {
    console.error('TLS error:', e.message);
    process.exit(1);
  });
}

(async () => {
  const ok = await probeProxy(proxyHost, proxyPort, 500);
  if (ok) {
    console.log(`Transport: proxy ${proxyHost}:${proxyPort} (timeout ${TIMEOUT_MS}ms)`);
    sendViaProxy();
  } else {
    if (proxyConfigured) {
      console.warn(`WARN: configured proxy ${proxyHost}:${proxyPort} unreachable; falling back to direct HTTPS`);
    }
    console.log(`Transport: direct HTTPS to api.anthropic.com (timeout ${TIMEOUT_MS}ms)`);
    sendDirect();
  }
})();
NODEJS_EOF

# --- Run the script ---
MCP_OWNER="$OWNER" \
MCP_REPO="$REPO" \
MCP_HEAD="$HEAD" \
MCP_BASE="$BASE" \
MCP_TITLE="$TITLE" \
MCP_BODY="$BODY" \
node "$PR_SCRIPT"

RESULT=$?
rm -f "$PR_SCRIPT"

if [[ $RESULT -ne 0 ]]; then
  echo ""
  echo "ERROR: PR creation failed" >&2
  exit 1
fi

echo ""
echo "=== PR created ==="
