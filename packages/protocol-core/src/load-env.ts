// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Zero-dependency `.env` loader for the Agent OS entrypoints (panel, relay, lobby).
 *
 * Reads a repo-root `.env` and copies its values into `process.env` **without overriding
 * variables already set in the real environment** — the real environment always wins
 * (the standard dotenv precedence). Intentionally tiny: `KEY=VALUE` lines, `#` comments,
 * optional surrounding quotes, and an optional leading `export `. No interpolation, no
 * multi-line values, no dependencies.
 *
 * BYOK / secrets: this only copies values into the current process — it never logs a value
 * and never transmits one. Keys you place in `.env` stay local, and `.env` is gitignored.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LoadEnvResult {
  /** Absolute path of the `.env` that was read, or `null` if none was found. */
  path: string | null;
  /** Names of variables newly applied from the file (excludes ones already set in env). */
  applied: string[];
}

/** Parse `.env` text into key/value pairs. Pure (no I/O) — exported for testing. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    const quoted = value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // strip a trailing inline comment only on unquoted values (` # ...`)
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Apply parsed pairs to a target env object, **never overriding** existing keys.
 * Returns the names actually applied. Pure over the target — exported for testing.
 */
export function applyEnv(
  pairs: Record<string, string>,
  target: NodeJS.ProcessEnv = process.env,
): string[] {
  const applied: string[] = [];
  for (const [k, v] of Object.entries(pairs)) {
    if (target[k] === undefined) {
      target[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

/**
 * Load a repo-root `.env` into `process.env` (real env wins). Safe to call once at startup;
 * a missing file is a no-op. Returns what was found/applied.
 */
export function loadEnv(repoRoot: string, fileName = '.env'): LoadEnvResult {
  const path = join(repoRoot, fileName);
  if (!existsSync(path)) return { path: null, applied: [] };
  const applied = applyEnv(parseEnv(readFileSync(path, 'utf8')));
  return { path, applied };
}
