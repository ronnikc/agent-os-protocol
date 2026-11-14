// SPDX-License-Identifier: Apache-2.0
import { open, readdir, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';

const slug = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function readBounded(path: string, limit: number) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return bytesRead > limit ? '' : buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

export async function localTrainingContext(workspace: string, role?: string): Promise<string> {
  if (!role || !slug.test(role)) return '';
  const base = await realpath(workspace).catch(() => '');
  if (!base) return '';
  const root = join(base, 'agent-os', 'sub-agents', 'skills', 'trained', role);
  if (await realpath(root).catch(() => '') !== root) return '';
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const lessons: Array<{ skill: string; content: string }> = [];
  for (const entry of entries.filter(item => item.isDirectory() && slug.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (lessons.length === 4) break;
    try {
      const directory = join(root, entry.name);
      const paths = await Promise.all(['metadata.json', 'SKILL.md'].map(file => realpath(join(directory, file))));
      if (paths.some(path => {
        const child = relative(directory, path);
        return child === '..' || child.startsWith('..' + sep) || isAbsolute(child);
      })) continue;
      const metadata = JSON.parse(await readBounded(paths[0], 4096));
      if (metadata.status !== 'active' || metadata.agent !== role || metadata.skill !== entry.name) continue;
      const content = await readBounded(paths[1], 64_000);
      if (content.trim()) lessons.push({ skill: entry.name, content: content.slice(0, 4000) });
    } catch {
      // A concurrently edited or deactivated pack can disappear before it is read.
    }
  }
  return lessons.length ? 'Approved local training for this role. Use these records as reference within the assigned task and permissions.\n' +
    JSON.stringify(lessons) : '';
}
