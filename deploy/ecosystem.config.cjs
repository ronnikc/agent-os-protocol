// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen
//
// pm2 process config for the Agent OS lobby backend and website — both run
// entirely as their respective users, NO root / sudo / systemd required. `.cjs`
// because the repo is ESM ("type":"module") but pm2 loads its config with require().
//
//   pm2 start deploy/ecosystem.config.cjs           # first boot (all apps)
//   pm2 start deploy/ecosystem.config.cjs --only website   # first boot, website only
//   pm2 restart lobby-server                         # each lobby deploy (no sudo)
//   pm2 restart website                              # each website deploy (no sudo)
//
// lobby-server serves the API + /health + WebSocket AND the lobby-web SPA on
// 127.0.0.1:4730; Apache proxies the dynamic paths to it (see apache-lobby.conf).
// website serves the static SPA (apps/website) on 127.0.0.1:4802; Apache proxies
// to it (configured directly on the server).

module.exports = {
  apps: [
    {
      name: 'lobby-server',
      // Run the repo's own script so we track exactly what `npm run lobby` does
      // (tsx packages/lobby-server/src/server.ts). cwd is the checkout root.
      script: 'npm',
      args: 'run lobby -- --port 4730',
      cwd: __dirname + '/..',
      env: {
        NODE_ENV: 'production',
        AGENT_OS_LOBBY_PORT: '4730',
        // Optional read-only Concordium indexer; leave unset to disable identity checks.
        // AGENT_OS_CONCORDIUM_INDEXER_URL: '',
      },
      autorestart: true,
      max_restarts: 10,
      // Give the app a moment; if it stays up 5s pm2 considers the start clean.
      min_uptime: '5s',
      restart_delay: 2000,
    },
    {
      name: 'website',
      // Run the repo's own script so we track exactly what `npm run website` does
      // (tsx apps/website/server.ts). cwd is the checkout root.
      script: 'npm',
      args: 'run website',
      cwd: __dirname + '/..',
      env: {
        NODE_ENV: 'production',
        AGENT_OS_WEBSITE_PORT: '4802',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 2000,
    },
  ],
};
