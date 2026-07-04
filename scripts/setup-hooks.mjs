#!/usr/bin/env node
// setup-hooks.mjs — point git at the committed .husky/ hook directory, dependency-free.
// Runs from `npm run setup-hooks` and (best-effort) from `prepare` on install.
// Never throws: a missing git binary or a non-repo checkout (published tarball) is a no-op.
import { execSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync('git config core.hooksPath .husky', { stdio: 'ignore' });
  // Best-effort make hooks executable (no-op semantics on Windows).
  const dir = '.husky';
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      try { chmodSync(join(dir, f), 0o755); } catch { /* ignore */ }
    }
  }
  console.log('git hooks installed → core.hooksPath=.husky');
} catch {
  // Not a git repo, or git unavailable — skip silently.
}
