#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * verify-ui — automated design and layout regression test suite.
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
const R = (p: string) => join(REPO_ROOT, p);

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

const read = (p: string) => readFileSync(R(p), 'utf8');

async function main(): Promise<void> {
  await check('Sprint reports an undelivered first task and accepts a successful delivery', async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const log = { innerHTML: '' };
    const requests: string[] = [];
    let delivered = false;
    const sandbox = {
      registerTab() {},
      escapeHtml: String,
      postJson: async (path: string) => {
        requests.push(path);
        return path === '/api/messages' ? { ok: true, sentToStaging: delivered } : { ok: true };
      },
      document: {
        getElementById(id: string) {
          if (id === 'sprint-exec-log') return log;
          return {
            querySelectorAll: () => [],
            addEventListener: (_event: string, callback: () => Promise<void>) => handlers.set(id, callback),
          };
        },
      },
    };
    runInNewContext(read('agent-os-panel/tabs/sprint.js').replace(/^import .+;$/m, '') +
      '\nsprintTasks = [{ title: "First task", priority: "normal" }]; render();', sandbox);
    const send = handlers.get('sprint-execute');
    assert.ok(send);
    await send();
    assert.deepEqual(requests, ['/api/tasks', '/api/messages']);
    assert.match(log.innerHTML, /did not reach the lobby/);
    delivered = true;
    await send();
    assert.match(log.innerHTML, /Sprint plan sent to lobby/);
  });
  console.log('verify-ui — UI layout, design tokens, and regressions\n');

  await check('Phase 2 panels expose labelled controls, status regions and paginated evidence', () => {
    const lobby = read('apps/lobby-web/index.html');
    const marketplace = read('apps/lobby-web/app.js');
    const apps = read('agent-os-panel/tabs/hosted-controls.js');
    assert.match(lobby, /id="marketplace-beta"[^>]+aria-labelledby="marketplace-beta-title"/);
    assert.match(lobby, /role="status" data-market-status/);
    assert.match(lobby, /<label>Lobby agent <select/);
    assert.match(marketplace, /delivery\.history\.data/);
    assert.match(marketplace, /button\.isConnected \? button : status/);
    assert.match(marketplace, /Retry loading marketplace/);
    assert.match(marketplace, /button\.disabled = true/);
    assert.match(apps, /role="status" data-history-status/);
    assert.match(apps, /Retry loading workspace controls/);
    assert.match(read('agent-os-panel/tabs/apps.js'), /aria-controls="apps-workspace-controls"/);
    assert.match(apps, /page\.data\.length/);
    for (const [name, prefix] of [['vercelTeam', 'team_'], ['vercelProject', 'prj_']]) {
      const pattern = apps.match(new RegExp('name="' + name + '" pattern="([^"]+)"'))?.[1];
      assert.ok(pattern);
      const browserPattern = new RegExp('^(?:' + pattern.replaceAll('\\\\', '\\') + ')$', 'v');
      assert.ok(browserPattern.test(prefix + 'example-01'));
      assert.ok(!browserPattern.test(prefix + 'bad/id'));
      assert.ok(!browserPattern.test(prefix));
    }
    assert.match(apps, /button\.textContent = 'Saving…'/);
  });

  // 1. Verify CSS design tokens
  await check('styles.css exists and has design tokens', () => {
    assert.ok(existsSync(R('agent-os-panel/styles.css')), 'styles.css is missing');
    const css = read('agent-os-panel/styles.css');
    
    const requiredTokens = [
      '--color-bg', '--color-bg-elevated', '--color-bg-soft', '--color-border',
      '--color-border-active', '--color-cyan', '--color-blue', '--color-violet',
      '--color-purple', '--color-green', '--color-yellow', '--color-red',
      '--color-text', '--color-text-muted', '--color-text-soft'
    ];
    
    for (const token of requiredTokens) {
      assert.ok(css.includes(token), `CSS token ${token} is missing in styles.css`);
    }
  });

  // 2. Verify index.html structure
  await check('index.html exists and contains the hex/cube SVG logo', () => {
    assert.ok(existsSync(R('agent-os-panel/index.html')), 'index.html is missing');
    const html = read('agent-os-panel/index.html');
    assert.ok(html.includes('<svg viewBox="0 0 24 24"'), 'index.html is missing the brand SVG logo mark');
    assert.ok(html.includes('grad-cyan-blue'), 'index.html is missing logo gradient definition');
  });

  await check('index.html contains all 11 tab buttons', () => {
    const html = read('agent-os-panel/index.html');
    const requiredTabs = [
      'agents', 'lobby', 'messages', 'tasks', 'requests', 'sprint', 'scheduled', 'files', 'gantt', 'memory', 'loop'
    ];
    for (const tab of requiredTabs) {
      assert.ok(html.includes(`data-tab="${tab}"`), `Tab button for "${tab}" is missing in index.html`);
    }
  });

  await check('index.html contains all 11 tab panes', () => {
    const html = read('agent-os-panel/index.html');
    const requiredPanes = [
      'tab-agents', 'tab-lobby', 'tab-messages', 'tab-tasks', 'tab-requests', 'tab-sprint', 'tab-scheduled', 'tab-files', 'tab-gantt', 'tab-memory', 'tab-loop'
    ];
    for (const pane of requiredPanes) {
      assert.ok(html.includes(`id="${pane}"`), `Tab pane "${pane}" is missing in index.html`);
    }
  });

  await check('index.html imports all 11 tab scripts', () => {
    const html = read('agent-os-panel/index.html');
    const requiredImports = [
      './tabs/agents.js', './tabs/lobby.js', './tabs/messages.js', './tabs/tasks.js', './tabs/requests.js',
      './tabs/sprint.js', './tabs/scheduled.js', './tabs/files.js', './tabs/gantt.js', './tabs/memory.js', './tabs/loop.js'
    ];
    for (const imp of requiredImports) {
      assert.ok(html.includes(`import '${imp}'`), `Tab script import for "${imp}" is missing in index.html`);
    }
  });

  // 3. Verify loop.js has necessary interactive controls
  await check('loop.js implements pause, resume, and checkpoint controls', () => {
    assert.ok(existsSync(R('agent-os-panel/tabs/loop.js')), 'loop.js is missing');
    const loopJs = read('agent-os-panel/tabs/loop.js');
    assert.ok(loopJs.includes('data-pause'), 'loop.js does not render pause button');
    assert.ok(loopJs.includes('data-resume'), 'loop.js does not render resume button');
    assert.ok(loopJs.includes('data-approve'), 'loop.js does not bind approve button');
    assert.ok(loopJs.includes('data-reject'), 'loop.js does not bind reject button');
  });

  // 4. Verify agents.js displays stats and new columns
  await check('agents.js renders all columns and overview stats', () => {
    assert.ok(existsSync(R('agent-os-panel/tabs/agents.js')), 'agents.js is missing');
    const agentsJs = read('agent-os-panel/tabs/agents.js');
    assert.ok(agentsJs.includes('getIdentityBadge'), 'agents.js does not render identity column');
    assert.ok(agentsJs.includes('getActivityIndicator'), 'agents.js does not render activity column');
    assert.ok(agentsJs.includes('updateOverviewStats'), 'agents.js does not support overview-stats API');
  });

  // 5. Verify apps/website static files and assets
  await check('website index.html exists and contains sections for problem, solution, modes, workflows, showcase, and docs-detail', () => {
    assert.ok(existsSync(R('apps/website/index.html')), 'website index.html is missing');
    const html = read('apps/website/index.html');
    assert.ok(html.includes('id="problem"'), 'website index.html is missing the problem section');
    assert.ok(html.includes('id="solution"'), 'website index.html is missing the solution section');
    assert.ok(html.includes('id="modes"'), 'website index.html is missing the modes section');
    assert.ok(html.includes('id="workflows"'), 'website index.html is missing the workflows section');
    assert.ok(html.includes('id="showcase"'), 'website index.html is missing the showcase gallery section');
    assert.ok(html.includes('id="docs-detail"'), 'website index.html is missing the docs-detail section');
    assert.ok(html.includes('https://concordium.com'), 'website index.html is missing the link to Concordium');
    assert.ok(html.includes('stroke-width: 2.5'), 'website index.html is missing the Concordium logo SVG path definition');
    assert.ok(html.includes('styles.css'), 'website index.html does not link styles.css');
  });

  await check('the website tour covers each panel tab in order and serves its screenshot', () => {
    const panel = read('agent-os-panel/index.html');
    const website = read('apps/website/index.html');
    const tabs = [...panel.matchAll(/<button data-tab="([^"]+)"/g)].map(match => match[1]);
    const tour = [...website.matchAll(/id="tour-tab-([^"]+)"[^>]*data-img="([^"]+)"/g)];
    assert.deepEqual(tour.map(match => match[1]), tabs);
    for (const [, , image] of tour) {
      assert.ok(existsSync(R(join('apps/website', image))), `Missing tour screenshot: ${image}`);
    }
  });

  await check('website styles.css exists and contains design tokens', () => {
    assert.ok(existsSync(R('apps/website/styles.css')), 'website styles.css is missing');
    const css = read('apps/website/styles.css');
    assert.ok(css.includes('--color-bg'), 'website styles.css is missing --color-bg');
    assert.ok(css.includes('--color-cyan'), 'website styles.css is missing --color-cyan');
    assert.ok(css.includes('--color-violet'), 'website styles.css is missing --color-violet');
    assert.ok(css.includes('backdrop-filter'), 'website styles.css does not implement glassmorphism blur');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-ui: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
