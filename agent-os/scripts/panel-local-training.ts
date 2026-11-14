// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const slugPattern = /^[a-z0-9][a-z0-9-]{0,59}$/;
const pending = new Set<string>();

export async function handleLocalTraining(req: IncomingMessage, res: ServerResponse, workspace: string) {
  function json(status: number, value: object) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) ||
      (req.headers.origin && req.headers.origin !== 'http://' + host) ||
      req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Use the local Panel to manage training.' });
  const inbox = join(workspace, 'agent-os', 'training', 'inbox');
  const trained = join(workspace, 'agent-os', 'sub-agents', 'skills', 'trained');
  async function getDraft(agent: string, skill: string) {
    const [draft, active] = await Promise.all([
      readFile(join(inbox, agent, skill, 'SKILL.md'), 'utf8').catch(() => ''),
      readFile(join(trained, agent, skill, 'SKILL.md'), 'utf8').catch(() => ''),
    ]);
    if (!draft && !active) return;
    return { id: agent + '/' + skill, slug: agent, title: skill, kind: 'train',
      status: active ? 'active' : 'draft', content: (active || draft).slice(0, 24000) };
  }
  try {
    if (req.method === 'GET') {
      const drafts = new Map();
      for (const base of [inbox, trained]) {
        for (const agent of await readdir(base, { withFileTypes: true }).catch(() => [])) {
          if (!agent.isDirectory() || !slugPattern.test(agent.name)) continue;
          for (const skill of await readdir(join(base, agent.name), { withFileTypes: true }).catch(() => [])) {
            if (!skill.isDirectory() || !slugPattern.test(skill.name)) continue;
            const draft = await getDraft(agent.name, skill.name);
            if (draft) drafts.set(draft.id, draft);
          }
        }
      }
      return json(200, { drafts: [...drafts.values()] });
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: 'Expected JSON.' });
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length <= 24000) chunks.push(chunk);
    }
    if (length > 24000) return json(413, { error: 'Training request is too large.' });
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const saving = body.action === 'save';
    const [agent, skill, extra] = saving
      ? [body.slug, typeof body.title === 'string' ? body.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '']
      : typeof body.id === 'string' ? body.id.split('/') : [];
    if (extra !== undefined || typeof agent !== 'string' || typeof skill !== 'string' ||
        !slugPattern.test(agent) || !slugPattern.test(skill)) return json(400, { error: 'Select a role and enter a valid lesson title.' });
    const cli = join(workspace, 'agent-os', 'scripts', 'train.mjs');
    const invoke = (args: string[]) => run(process.execPath, [cli, agent, ...args], { cwd: workspace, timeout: 10000 });
    const operation = join(workspace, agent, skill);
    if (pending.has(operation)) return json(409, { error: 'Another action is running for this lesson.' });
    pending.add(operation);
    try {
      const draft = await getDraft(agent, skill);
      if (saving) {
        if (draft) return json(409, { error: 'A lesson with this name already exists.' });
        if (body.kind !== 'train' || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 16000)
          return json(400, { error: 'Enter training guidance.' });
        const dir = await mkdtemp(join(tmpdir(), 'agent-os-panel-training-'));
        const source = join(dir, 'guidance.md');
        try {
          await writeFile(source, body.content, { mode: 0o600 });
          await invoke(['--source', source, '--skill', skill]);
          return json(201, { draft: await getDraft(agent, skill) });
        } finally {
          await unlink(source).catch(() => {});
          await rmdir(dir).catch(() => {});
        }
      }
      if (body.action === 'activate' && draft?.status === 'draft') await invoke(['--activate', skill]);
      else if (body.action === 'retire' && draft?.status === 'active') await invoke(['--deactivate', skill]);
      else return json(409, { error: 'That action is unavailable for this lesson.' });
      return json(200, { ok: true });
    } finally {
      pending.delete(operation);
    }
  } catch (error) {
    const result = error as { stderr?: string };
    return json(400, { error: result.stderr?.split(/\r?\n/)[0] || 'Local training could not be completed.' });
  }
}
